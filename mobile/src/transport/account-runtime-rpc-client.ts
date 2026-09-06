import {
  attachAccountRuntimeStream,
  type AccountRuntimeStream as Stream
} from './account-runtime-rpc-stream'
import { classifyHiveAccountRelayError } from '../../../src/shared/hive-account-relay-errors'
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

function classifyAccountRuntimeRecovery(error: unknown, attempt = 0) {
  // A changed Runtime revision is a connection conflict, never a pairing failure.
  const conflict = error && typeof error === 'object' && 'status' in error && error.status === 409
  return classifyHiveAccountRelayError(conflict ? { ...error, retryable: true } : error, attempt)
}

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
    return this.requests
      .request(this.pool!, this.streams, method, params, options?.timeoutMs)
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
    if (this.closed) {
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
      if (stream.retryTimer) {
        clearTimeout(stream.retryTimer)
        stream.retryTimer = null
      }
      stream.physical?.close()
      stream.physical = null
      stream.generation = -1
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
    this.retryAttempt = 0
    if (reason === 'network-change') {
      this.suspend()
    }
    if (this.pool?.getState() === 'idle') {
      this.suspend()
    }
    this.resume()
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
      if (stream.retryTimer) {
        clearTimeout(stream.retryTimer)
        stream.retryTimer = null
      }
      stream.physical = null
      stream.generation = 0
    }
    previous?.close()
    this.publish('disconnected')
  }

  private resume(): void {
    if (this.closed || this.terminalFailure || this.pool || AppState.currentState !== 'active') {
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
          if (error && !classifyAccountRuntimeRecovery(error).retryable) {
            this.terminalFailure = true
            this.suspend()
            this.publish('auth-failed')
            return
          }
          this.publish('disconnected')
        }
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
        this.onLog({
          id: `account-connect-${generation}`,
          ts: Date.now(),
          level: 'warn',
          message: '账号远程连接失败，请重试',
          code: 'relay-dial-failed',
          path: 'relay'
        })
        this.scheduleRecovery(error)
      })
  }

  private attach(stream: Stream, pool: HiveAccountRelayPool): void {
    if (stream.generation !== 0 || !this.streams.has(stream)) {
      return
    }
    const generation = ++this.streamSequence
    stream.generation = generation
    attachAccountRuntimeStream(stream, pool, {
      current: () =>
        this.pool === pool && this.streams.has(stream) && stream.generation === generation,
      onInbound: () => {
        this.lastInboundAt = Date.now()
        stream.retryAttempt = 0
      },
      onEnded: () => void this.streams.delete(stream),
      onClosed: (error) => {
        // Each subscription owns a separate channel. A failed stream must not
        // disconnect requests or other screens that still have healthy channels.
        stream.generation = 0
        stream.physical?.close()
        stream.physical = null
        const recovery = classifyAccountRuntimeRecovery(error, stream.retryAttempt)
        if (!recovery.retryable || stream.retryAttempt >= 5) {
          this.streams.delete(stream)
          stream.listener({ type: 'error', message: '会话连接中断，请重新打开后重试' })
          return
        }
        stream.retryAttempt++
        stream.retryTimer = setTimeout(
          () => {
            stream.retryTimer = null
            if (this.pool === pool && this.streams.has(stream)) {
              this.attach(stream, pool)
            }
          },
          Math.max(250, recovery.retryDelayMs)
        )
      }
    })
  }

  private scheduleRecovery(error: unknown): void {
    const recovery = classifyAccountRuntimeRecovery(error, this.retryAttempt)
    if (!recovery.retryable) {
      this.terminalFailure = true
      this.publish('auth-failed')
      return
    }
    if (
      this.closed ||
      AppState.currentState !== 'active' ||
      this.retryTimer ||
      this.retryAttempt >= 5
    ) {
      return
    }
    this.retryAttempt += 1
    const delay = recovery.retryDelayMs
    this.publish('reconnecting')
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
