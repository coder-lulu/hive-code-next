import { MobileRelayE2eeLink } from '../transport/mobile-relay-e2ee-link'
import { MobileRelayRpcStreams } from '../transport/mobile-relay-rpc-streams'
import { MobileE2EEAuthenticationError } from '../transport/mobile-e2ee-v2-physical-channel'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  openRpcRequestBudget,
  resolvePostConnectRequestTimeout
} from '../transport/rpc-request-budget'
import { isRpcResponse } from '../transport/rpc-response-shape'
import { RpcSessionLivenessWatchdog } from '../transport/rpc-session-liveness-watchdog'
import type { RpcClient } from '../transport/rpc-client'
import type {
  AccountRuntimeConnectionMaterial,
  ConnectionLogSink,
  ConnectionState,
  RpcResponse
} from '../transport/types'

const PROBE_TIMEOUT_MS = 4_000
const MISSED_PROBE_LIMIT = 2

type PendingRequest = {
  resolve: (response: RpcResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function connectAccountRuntimeRpcSession(args: {
  readonly connection: AccountRuntimeConnectionMaterial
  readonly requestTimeoutMs?: number
  readonly createSocket?: (url: string) => WebSocket
  readonly onLog?: ConnectionLogSink
}): RpcClient {
  const requestTimeoutMs = args.requestTimeoutMs ?? 30_000
  const pending = new Map<string, PendingRequest>()
  const stateListeners = new Set<(state: ConnectionState) => void>()
  let state: ConnectionState = 'connecting'
  let requestCounter = 0
  let lastConnectedAt: number | null = null
  let failure: Error | null = null
  let closed = false
  const livenessIdentity = {}
  const streams = new MobileRelayRpcStreams({
    nextId,
    sendFrame,
    waitForConnected: () => waitForConnected()
  })
  const link = new MobileRelayE2eeLink({
    endpoint: args.connection.relay,
    credential: {
      ticketId: args.connection.ticketId,
      ticketSecret: args.connection.ticketSecret
    },
    expectedCredentialKind: 'ticket',
    deviceToken: args.connection.ticketSecret,
    desktopPublicKeyB64: args.connection.runtimePublicKeyB64,
    clientKeyPair: args.connection.clientKeyPair,
    createSocket: args.createSocket,
    onHello: (hello) => {
      if (closed) {
        return
      }
      if (hello.credentialKind !== 'ticket' || hello.leaseExpiresAt <= Date.now()) {
        fail(new Error('account Runtime ticket lease is invalid'))
        return
      }
      publishState('handshaking')
    },
    onAuthenticated: () => {
      if (closed) {
        return
      }
      lastConnectedAt = Date.now()
      liveness.start(livenessIdentity)
      publishState('connected')
    },
    onText: (plaintext) => {
      if (closed) {
        return
      }
      liveness.noteAuthenticatedInbound(livenessIdentity)
      handleText(plaintext)
    },
    onBinary: (plaintext) => {
      if (closed) {
        return
      }
      liveness.noteAuthenticatedInbound(livenessIdentity)
      streams.handleBinary(plaintext)
    },
    onError: fail
  })

  const client: RpcClient = {
    async sendRequest(method, params, options) {
      const budget = openRpcRequestBudget(options)
      await waitForConnected(budget.timeoutMs)
      return sendRpc(method, params, resolvePostConnectRequestTimeout(budget, requestTimeoutMs))
    },
    subscribe(method, params, listener, options) {
      return closed ? () => {} : streams.subscribe(method, params, listener, options)
    },
    updateTerminalSubscriptionViewport: (terminal, viewport) =>
      streams.updateTerminalViewport(terminal, viewport),
    getState: () => state,
    getReconnectAttempt: () => (failure ? 1 : 0),
    getLastConnectedAt: () => lastConnectedAt,
    getLastInboundAt: () => liveness.getLastInboundAt() || null,
    onStateChange(listener) {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
    notifyForeground: () => {
      if (state === 'connected') {
        liveness.probeNow(livenessIdentity)
      }
    },
    close() {
      if (closed) {
        return
      }
      closed = true
      liveness.stop(livenessIdentity)
      link.close()
      rejectPending(new Error('Client closed'))
      streams.clear()
      publishState('disconnected')
    }
  }

  const liveness = new RpcSessionLivenessWatchdog({
    transport: 'relay',
    idleProbeMs: null,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    missedProbeLimit: MISSED_PROBE_LIMIT,
    voluntaryProbeMinIntervalMs: 10_000,
    sendProbe: () => state === 'connected' && sendFrame({ id: nextId(), method: 'status.get' }),
    onTimeout: (evidence) => {
      args.onLog?.({
        id: `account-runtime-liveness-${Date.now()}`,
        ts: Date.now(),
        level: 'error',
        code: 'liveness-timeout',
        path: 'relay',
        message: 'Cloud Runtime health check failed',
        detail: `${evidence.missedProbes}/${evidence.missedProbeLimit} probes missed`
      })
    },
    terminate: () => fail(new Error('account Runtime session liveness timeout'))
  })
  return client

  function sendRpc(method: string, params: unknown, timeoutMs: number): Promise<RpcResponse> {
    if (closed || state !== 'connected') {
      return Promise.reject(new Error('account Runtime session not connected'))
    }
    const id = nextId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(markRpcDeliveryUnknown(new Error(`account Runtime RPC timed out: ${method}`)))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      if (!sendFrame({ id, method, params })) {
        clearTimeout(timer)
        pending.delete(id)
        reject(new Error('account Runtime E2EE channel not ready'))
      }
    })
  }

  function sendFrame(frame: { id: string; method: string; params?: unknown }): boolean {
    return link.sendText(JSON.stringify({ ...frame, deviceToken: args.connection.ticketSecret }))
  }

  function handleText(plaintext: string): void {
    let value: unknown
    try {
      value = JSON.parse(plaintext)
    } catch {
      return
    }
    if (!isRpcResponse(value)) {
      return
    }
    const request = pending.get(value.id)
    if (request) {
      clearTimeout(request.timer)
      pending.delete(value.id)
      request.resolve(value)
    } else {
      streams.handleResponse(value)
    }
  }

  function waitForConnected(timeoutMs = requestTimeoutMs): Promise<void> {
    if (state === 'connected') {
      return Promise.resolve()
    }
    if (closed || state === 'disconnected' || state === 'auth-failed') {
      return Promise.reject(new Error(`account Runtime session ${state}`))
    }
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const unsubscribe = client.onStateChange((next) => {
        if (next === 'connected') {
          finish()
          resolve()
        } else if (next === 'disconnected' || next === 'auth-failed') {
          finish()
          reject(new Error(`account Runtime session ${next}`))
        }
      })
      timer = setTimeout(() => {
        finish()
        reject(new Error('account Runtime session connection timed out'))
      }, timeoutMs)
      function finish(): void {
        if (timer) {
          clearTimeout(timer)
        }
        unsubscribe()
      }
    })
  }

  function publishState(next: ConnectionState): void {
    if (state === next) {
      return
    }
    state = next
    for (const listener of stateListeners) {
      listener(next)
    }
  }

  function fail(error: Error): void {
    if (closed) {
      return
    }
    closed = true
    failure = error
    liveness.stop(livenessIdentity)
    link.close()
    rejectPending(error)
    streams.clear()
    publishState(error instanceof MobileE2EEAuthenticationError ? 'auth-failed' : 'disconnected')
  }

  function rejectPending(error: Error): void {
    if (pending.size > 0) {
      markRpcDeliveryUnknown(error)
    }
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }

  function nextId(): string {
    return `account-runtime-${++requestCounter}-${Date.now()}`
  }
}
