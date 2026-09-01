import WebSocket from 'ws'
import {
  REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES,
  serializeRemoteRuntimeRpcRequest
} from '../../shared/remote-runtime-memory-limits'
import type { RemoteRuntimeSubscription } from '../../shared/remote-runtime-client'
import type * as RuntimeRpc from '../../shared/runtime-rpc-envelope'
import {
  createWsOutboundBackpressureQueue,
  type WsOutboundBackpressureQueue
} from '../../shared/ws-outbound-backpressure-queue'
import type { HiveAccountRuntimeConnectionMaterial } from './hive-account-runtime-connection-material'
import { HiveAccountRuntimeRelayAuthorizationDeadline } from './hive-account-runtime-relay-authorization-deadline'
import { HiveAccountRuntimeClientE2ee } from './hive-account-runtime-relay-e2ee'
import {
  reserveHiveAccountRuntimeRelayOutbound,
  type HiveAccountRuntimeRelayOutboundFrame
} from './hive-account-runtime-relay-outbound-admission'
import {
  asRelayError,
  defaultRelayConnectionDependencies,
  parseRelayTicketHello,
  parseRuntimeResponse,
  relayConnectionError,
  relayProtocolError,
  relayRawDataBytes,
  relaySocketUrl,
  type RelayConnectionDependencies,
  type RelaySocket
} from './hive-account-runtime-relay-protocol'
import {
  HiveAccountRuntimeRelayRequests,
  type RelaySubscriptionCallbacks
} from './hive-account-runtime-relay-requests'

export class HiveAccountRuntimeRelayConnection {
  private readonly socket: RelaySocket
  private readonly crypto: HiveAccountRuntimeClientE2ee
  private readonly requests = new HiveAccountRuntimeRelayRequests()
  private readonly outbound: WsOutboundBackpressureQueue<HiveAccountRuntimeRelayOutboundFrame>
  private state: 'OUTER' | 'E2EE_READY' | 'AUTHENTICATING' | 'ACTIVE' | 'CLOSED' = 'OUTER'
  private connectResolve: (() => void) | null = null
  private connectReject: ((error: Error) => void) | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly releaseSocketMemory: () => void
  private readonly authorizationDeadline: HiveAccountRuntimeRelayAuthorizationDeadline

  constructor(
    private readonly material: HiveAccountRuntimeConnectionMaterial,
    private readonly dependencies: RelayConnectionDependencies = defaultRelayConnectionDependencies
  ) {
    this.crypto = new HiveAccountRuntimeClientE2ee(material)
    this.authorizationDeadline = new HiveAccountRuntimeRelayAuthorizationDeadline(
      dependencies.now,
      () => this.fail(relayConnectionError('Cloud Runtime connection authorization expired.'))
    )
    this.socket = dependencies.createSocket(relaySocketUrl(material.relay))
    const outboundAdmission = reserveHiveAccountRuntimeRelayOutbound({
      readBufferedAmount: () => this.socket.bufferedAmount,
      terminateSocket: () => this.socket.terminate(),
      memoryBudget: dependencies.outboundMemoryBudget
    })
    this.releaseSocketMemory = outboundAdmission.release
    this.outbound = createWsOutboundBackpressureQueue({
      // Encryption is deliberately deferred until dequeue so rejecting a queued
      // frame cannot consume an ordered E2EE counter.
      send: (frame) =>
        this.socket.send(
          frame.kind === 'text'
            ? this.crypto.sealText(frame.plaintext)
            : this.crypto.sealBinary(frame.plaintext)
        ),
      getBufferedAmount: () => this.socket.bufferedAmount,
      isWritable: () => this.state === 'ACTIVE' && this.socket.readyState === WebSocket.OPEN,
      onOverflow: () =>
        this.fail(relayConnectionError('Cloud Runtime outbound buffer overflowed.')),
      ...outboundAdmission.queueOptions
    })
    this.bindSocket()
  }

  connect(timeoutMs: number): Promise<void> {
    if (this.state === 'ACTIVE') {
      return Promise.resolve()
    }
    if (this.connectResolve || this.connectReject || this.state === 'CLOSED') {
      return Promise.reject(relayConnectionError('Cloud Runtime connection is not available.'))
    }
    return new Promise((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
      this.connectTimer = setTimeout(
        () => this.fail(relayConnectionError('Timed out connecting to the Cloud Runtime.')),
        timeoutMs
      )
    })
  }

  request<TResult>(
    method: string,
    params: unknown,
    timeoutMs: number,
    envelope?: RuntimeRpc.RuntimeOrchestrationEnvelope
  ): Promise<RuntimeRpc.RuntimeRpcResponse<TResult>> {
    if (this.state !== 'ACTIVE') {
      return Promise.reject(relayConnectionError('Cloud Runtime E2EE session is not ready.'))
    }
    return this.requests.request<TResult>(
      timeoutMs,
      (id) => this.serializeRpc(id, method, params, envelope),
      (serializedRequest) => this.enqueueRpc(serializedRequest)
    )
  }

  subscribe(
    method: string,
    params: unknown,
    callbacks: RelaySubscriptionCallbacks
  ): RemoteRuntimeSubscription {
    if (this.state !== 'ACTIVE') {
      throw relayConnectionError('Cloud Runtime E2EE session is not ready.')
    }
    const requestId = this.requests.subscribe(callbacks, (id) =>
      this.enqueueRpc(this.serializeRpc(id, method, params))
    )
    return {
      requestId,
      close: () => {
        this.requests.removeSubscription(requestId)
        this.close()
      },
      sendBinary: (bytes) => this.sendBinary(bytes),
      sendRequest: (requestMethod, requestParams, requestTimeoutMs) =>
        this.request(requestMethod, requestParams, requestTimeoutMs)
    }
  }

  close(): void {
    if (this.state === 'CLOSED') {
      return
    }
    this.state = 'CLOSED'
    this.clearConnectionTimers()
    const error = relayConnectionError('Cloud Runtime connection closed.')
    this.connectReject?.(error)
    this.connectResolve = null
    this.connectReject = null
    this.outbound.dispose()
    try {
      this.socket.close()
    } catch {
      // Best-effort shutdown; all callers are still settled below.
    }
    this.requests.rejectAll(error)
    this.requests.notifyClosed()
  }

  private bindSocket(): void {
    this.socket.once('open', () => {
      this.socket.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: {
            ticketId: this.material.ticketId,
            ticketSecret: this.material.ticketSecret
          }
        })
      )
    })
    this.socket.on('message', (raw: WebSocket.RawData, isBinary: boolean) => {
      try {
        this.handleMessage(raw, isBinary)
      } catch (error) {
        this.fail(relayProtocolError(asRelayError(error).message))
      }
    })
    this.socket.once('error', () =>
      this.fail(relayConnectionError('Could not connect to the Cloud Runtime relay.'))
    )
    this.socket.once('close', () => {
      this.releaseSocketMemory()
      this.fail(relayConnectionError('Cloud Runtime relay closed the connection.'))
    })
  }

  private handleMessage(raw: WebSocket.RawData, isBinary: boolean): void {
    if (this.state === 'CLOSED') {
      return
    }
    if (this.state === 'OUTER') {
      if (isBinary) {
        throw new Error('binary outer handshake')
      }
      const hello = parseRelayTicketHello(raw.toString(), this.dependencies.now())
      if (!hello) {
        throw new Error('invalid relay ticket hello')
      }
      if (!this.authorizationDeadline.start(hello.leaseExpiresAt, this.material.expiresAt)) {
        throw new Error('expired relay authorization')
      }
      this.state = 'E2EE_READY'
      this.socket.send(JSON.stringify(this.crypto.hello))
      return
    }
    if (this.state === 'E2EE_READY') {
      if (isBinary || !this.crypto.acceptReady(raw.toString())) {
        throw new Error('invalid E2EE ready')
      }
      this.state = 'AUTHENTICATING'
      this.socket.send(
        this.crypto.sealText(
          JSON.stringify({
            type: 'e2ee_auth',
            v: 2,
            transcriptHashB64: this.crypto.transcriptHashB64,
            deviceToken: this.material.ticketSecret
          })
        )
      )
      return
    }
    const plaintext = isBinary
      ? this.crypto.openBinary(relayRawDataBytes(raw))
      : this.crypto.openText(raw.toString())
    if (plaintext === null) {
      throw new Error('invalid encrypted frame')
    }
    if (this.state === 'AUTHENTICATING') {
      if (typeof plaintext !== 'string' || !this.crypto.isAuthenticated(plaintext)) {
        throw new Error('E2EE authentication rejected')
      }
      this.state = 'ACTIVE'
      // The ticket hello's short attach reservation fences only the handshake.
      this.clearConnectionTimers()
      this.connectResolve?.()
      this.connectResolve = null
      this.connectReject = null
      return
    }
    if (this.state !== 'ACTIVE') {
      throw new Error('message before authentication')
    }
    if (typeof plaintext !== 'string') {
      this.requests.dispatchBinary(plaintext)
      return
    }
    const response = parseRuntimeResponse(plaintext)
    if (response) {
      this.requests.dispatchResponse(response)
    }
  }

  private serializeRpc(
    id: string,
    method: string,
    params: unknown,
    envelope?: RuntimeRpc.RuntimeOrchestrationEnvelope
  ): string {
    return serializeRemoteRuntimeRpcRequest({
      requestId: id,
      deviceToken: this.material.ticketSecret,
      method,
      params,
      envelope
    })
  }

  private enqueueRpc(plaintext: string): { cancel: () => boolean } {
    const queued = this.outbound.enqueueCancelable({ kind: 'text', plaintext })
    if (!queued.accepted) {
      throw relayConnectionError('Cloud Runtime outbound queue is unavailable.')
    }
    return { cancel: queued.cancel }
  }

  private sendBinary(bytes: Uint8Array<ArrayBufferLike>): boolean {
    if (
      this.state !== 'ACTIVE' ||
      this.socket.readyState !== WebSocket.OPEN ||
      bytes.byteLength > REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES
    ) {
      return false
    }
    return this.outbound.enqueue({ kind: 'binary', plaintext: new Uint8Array(bytes) })
  }

  private fail(error: ReturnType<typeof relayConnectionError>): void {
    if (this.state === 'CLOSED') {
      return
    }
    this.state = 'CLOSED'
    this.clearConnectionTimers()
    this.connectReject?.(error)
    this.connectResolve = null
    this.connectReject = null
    this.outbound.dispose()
    this.requests.rejectAll(error)
    this.requests.notifyError(error)
    try {
      this.socket.terminate()
    } catch {
      this.releaseSocketMemory()
      // best-effort transport retirement
    }
  }

  private clearConnectionTimers(): void {
    this.authorizationDeadline.clear()
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }
}
