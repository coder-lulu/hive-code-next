import type { AccountRuntimeStream as Stream } from './account-runtime-rpc-stream'
import {
  accountRuntimeRecovery,
  logAccountRuntimeRecovery,
  logAccountRuntimeDialFailure
} from './account-runtime-recovery'
import {
  detachAccountRuntimeStream,
  recoverAccountRuntimeStream
} from './account-runtime-stream-recovery'
import { AppState } from 'react-native'
import { HiveAccountRelayPool } from '../../../src/shared/hive-account-relay-pool'
import type { HiveAccountRelaySocket } from '../../../src/shared/hive-account-relay-channel'
import { registerAccountRuntimeClient } from '../runtime-directory/account-runtime-client-registry'
import type { RpcClient, SendRequestOptions } from './rpc-client'
import { updateTerminalSubscriptionViewport } from './rpc-client-terminal-subscription'
import { MOBILE_RUNTIME_CLIENT_CAPABILITIES } from './mobile-runtime-client-capabilities'
import { mobileRuntimeRandomBytes } from './runtime-random'
import type { AccountRuntimeRoute, ConnectionLogSink, ConnectionState, RpcResponse } from './types'
import { AccountRuntimeRpcRequests } from './account-runtime-rpc-requests'

/** Mobile lifecycle and presentation adapter for the shared authenticated pool. */
export class AccountRuntimeRpcClient implements RpcClient {
  private pool: HiveAccountRelayPool | null = null
  private state: ConnectionState = 'connecting'
  private closed = false
  private generation = 0
  private streamSequence = 0
  private lastConnectedAt: number | null = null
  private lastInboundAt: number | null = null
  private terminalFailure = false
  private retryAttempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private recoveryNeedsStream = false
  private retryNotBefore = 0
  private readonly listeners = new Set<(state: ConnectionState) => void>()
  private readonly streams = new Set<Stream>()
  private readonly requests = new AccountRuntimeRpcRequests()
  private readonly unregister: () => void
  private readonly appStateSubscription: { remove(): void }

  constructor(
    hostId: string,
    private readonly route: AccountRuntimeRoute,
    private readonly onLog: ConnectionLogSink
  ) {
    this.unregister = registerAccountRuntimeClient({
      hostId,
      runtimeRecordId: route.runtimeRecordId,
      resourceVersion: route.resourceVersion,
      accessMode: 'account-only'
    })
    this.appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        this.notifyForeground('app-resume')
      } else {
        this.suspend()
      }
    })
    if (AppState.currentState === 'active') {
      this.resume()
    } else {
      this.publish('disconnected')
    }
  }

  sendRequest(
    method: string,
    params?: unknown,
    options?: SendRequestOptions
  ): Promise<RpcResponse> {
    if (this.closed || this.terminalFailure || AppState.currentState !== 'active') {
      return Promise.reject(new Error('Account Runtime client is inactive'))
    }
    if (options?.failWhenDisconnected && this.state !== 'connected') {
      return Promise.reject(new Error('Account Runtime is disconnected'))
    }
    this.resume()
    if (!this.pool) {
      return Promise.reject(new Error('Account Runtime is reconnecting'))
    }
    return this.requests
      .request(this.pool, this.streams, method, params, options?.timeoutMs)
      .then((response) => {
        this.lastInboundAt = Date.now()
        return response
      })
  }

  subscribe(
    method: string,
    params: unknown,
    listener: Parameters<RpcClient['subscribe']>[2],
    options?: Parameters<RpcClient['subscribe']>[3]
  ): () => void {
    if (this.closed || this.terminalFailure) {
      return () => {}
    }
    const stream: Stream = {
      method,
      params,
      listener,
      options,
      physical: null,
      generation: 0,
      retryAttempt: 0,
      retryTimer: null
    }
    this.streams.add(stream)
    this.resume()
    if (this.pool) {
      this.attach(stream, this.pool)
    }
    return () => {
      this.streams.delete(stream)
      detachAccountRuntimeStream(stream)
      if (!this.streams.size && this.recoveryNeedsStream && this.retryTimer) {
        this.suspend()
      }
    }
  }

  updateTerminalSubscriptionViewport(
    terminal: string,
    viewport: { cols: number; rows: number }
  ): void {
    updateTerminalSubscriptionViewport(this.streams, terminal, viewport)
  }

  getState = (): ConnectionState => this.state
  getReconnectAttempt = (): number => this.retryAttempt
  getLastConnectedAt = (): number | null => this.lastConnectedAt
  getLastInboundAt = (): number | null => this.lastInboundAt
  onStateChange = (listener: (state: ConnectionState) => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notifyForeground(reason: Parameters<RpcClient['notifyForeground']>[0] = 'focus'): void {
    if (this.closed || this.terminalFailure || AppState.currentState !== 'active') {
      return
    }
    if (this.retryTimer) {
      return
    }
    if (reason === 'network-change') {
      this.suspend()
    }
    if (this.pool?.getState() === 'idle' && !this.streams.size) {
      this.suspend()
    }
    this.resume()
    for (const stream of this.streams) {
      stream.health?.probeNow(stream)
    }
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.appStateSubscription.remove()
    this.unregister()
    this.suspend()
    this.streams.clear()
    this.listeners.clear()
  }

  private suspend(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
    }
    this.retryTimer = null
    this.generation += 1
    const previous = this.pool
    this.pool = null
    for (const stream of this.streams) {
      detachAccountRuntimeStream(stream)
    }
    previous?.close()
    this.publish('disconnected')
  }

  private resume(): void {
    if (
      this.closed ||
      this.terminalFailure ||
      this.pool ||
      this.retryTimer ||
      AppState.currentState !== 'active'
    ) {
      return
    }
    if (Date.now() < this.retryNotBefore) {
      this.publish('reconnecting')
      this.armRecovery(this.retryNotBefore - Date.now())
      return
    }
    const generation = ++this.generation
    const pool = new HiveAccountRelayPool({
      randomBytes: mobileRuntimeRandomBytes,
      clientCapabilities: MOBILE_RUNTIME_CLIENT_CAPABILITIES,
      createMaterial: () => this.route.createConnection(),
      // React Native and DOM differ only in callback event declarations here.
      createSocket: (url) => new WebSocket(url) as unknown as HiveAccountRelaySocket,
      onStateChange: (state) => {
        if (this.pool !== pool || generation !== this.generation) {
          return
        }
        if (state === 'ready') {
          this.retryAttempt = 0
          this.lastConnectedAt = Date.now()
          this.publish('connected')
        } else if (state === 'connecting') {
          this.publish('connecting')
        } else {
          const error = pool.getLastError()
          if (error && !accountRuntimeRecovery(error).retryable) {
            this.terminalFailure = true
            this.suspend()
            this.publish('auth-failed')
            return
          }
          this.publish('disconnected')
        }
      },
      onConnectionLost: (error) => {
        if (this.pool !== pool || !this.streams.size) {
          return
        }
        this.recoveryNeedsStream = true
        this.suspend()
        this.scheduleRecovery(error)
      }
    })
    this.pool = pool
    this.publish('connecting')
    void pool
      .connect()
      .then(() => {
        if (this.pool !== pool) {
          return
        }
        for (const stream of this.streams) {
          this.attach(stream, pool)
        }
      })
      .catch((error: unknown) => {
        if (this.pool !== pool) {
          return
        }
        this.suspend()
        logAccountRuntimeDialFailure(this.onLog, generation)
        this.scheduleRecovery(error)
      })
  }

  private attach(stream: Stream, pool: HiveAccountRelayPool): void {
    if (stream.generation !== 0 || stream.retryTimer || !this.streams.has(stream)) {
      return
    }
    recoverAccountRuntimeStream(stream, pool, {
      generation: ++this.streamSequence,
      current: () => this.pool === pool && this.streams.has(stream),
      onInbound: () => {
        this.lastInboundAt = Date.now()
      },
      onEnded: () => void this.streams.delete(stream),
      reattach: () => this.attach(stream, pool),
      onRetryAfter: (deadline) => {
        this.retryNotBefore = Math.max(this.retryNotBefore, deadline)
      },
      onLog: this.onLog
    })
  }

  private scheduleRecovery(error: unknown): void {
    const { retryable, retryDelayMs: delay } = accountRuntimeRecovery(error, this.retryAttempt)
    if (!retryable) {
      this.terminalFailure = true
      this.publish('auth-failed')
      return
    }
    if (
      this.closed ||
      AppState.currentState !== 'active' ||
      this.retryTimer ||
      (this.recoveryNeedsStream && !this.streams.size)
    ) {
      return
    }
    this.retryAttempt += 1
    this.retryNotBefore = Date.now() + delay
    logAccountRuntimeRecovery(this.onLog, error, this.retryAttempt, delay, 'connection')
    this.publish('reconnecting')
    this.armRecovery(delay)
  }

  private armRecovery(delay: number): void {
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.resume()
    }, delay)
  }

  private publish(state: ConnectionState): void {
    if (state === this.state) {
      return
    }
    this.state = state
    for (const listener of this.listeners) {
      listener(state)
    }
  }
}
