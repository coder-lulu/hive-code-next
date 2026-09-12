import { relayBase64Url, type HiveAccountRelayMaterial } from './hive-account-relay-material'
import type { RuntimeE2EEClientSession } from './runtime-e2ee-client-session'
import { HiveAccountRelayHandshake } from './hive-account-relay-channel-handshake'
import { HiveAccountRelayRequests } from './hive-account-relay-requests'
import { RemoteRuntimeClientError } from './remote-runtime-client-error'
import { HiveAccountRelayClosedError } from './hive-account-relay-errors'
import { parseRemoteRuntimeRpcFrame } from './remote-runtime-request-frames'
import { serializeRemoteRuntimePayload } from './remote-runtime-memory-limits'
import type { RuntimeRpcResponse } from './runtime-rpc-envelope'
import type { RuntimeCapability } from './protocol-version'
import {
  assertRelayRequest,
  relayBinary,
  relayPayloadBytes,
  type HiveAccountRelayRequest,
  type HiveAccountRelaySocket,
  type HiveAccountRelaySubscription
} from './hive-account-relay-channel-protocol'

export type {
  HiveAccountRelayRequest,
  HiveAccountRelaySocket,
  HiveAccountRelaySubscription
} from './hive-account-relay-channel-protocol'
const MAX_BUFFER = 16 * 1024 * 1024
const MAX_FRAME = 8 * 1024 * 1024 + 82
const failure = (message: string) =>
  new RemoteRuntimeClientError('remote_runtime_unavailable', message)

/** One authenticated physical connection; a stream owns its connection until disposal. */
export class HiveAccountRelayChannel {
  private state: 'new' | 'handshaking' | 'connected' | 'closed' = 'new'
  private handshake: HiveAccountRelayHandshake | null = null
  private socket: HiveAccountRelaySocket | null = null
  private session: RuntimeE2EEClientSession | null = null
  private pending = new HiveAccountRelayRequests()
  private subscription: { id: string; callbacks: HiveAccountRelaySubscription } | null = null
  private incoming = Promise.resolve()
  private incomingBytes = 0
  private incomingCount = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private connection: Promise<void> | null = null
  private resolveConnection: (() => void) | null = null
  private rejectConnection: ((error: Error) => void) | null = null

  constructor(
    private readonly options: {
      material: HiveAccountRelayMaterial
      createSocket: (url: string) => HiveAccountRelaySocket
      onClosed?: (error: Error, intentional: boolean) => void
      handshakeTimeoutMs?: number
      clientCapabilities?: readonly RuntimeCapability[]
      randomBytes?: (length: number) => Uint8Array
    }
  ) {}

  get isReady(): boolean {
    return this.state === 'connected'
  }
  get isClosed(): boolean {
    return this.state === 'closed'
  }

  connect(): Promise<void> {
    if (this.isClosed) {
      return Promise.reject(failure('Relay connection is closed'))
    }
    if (this.connection) {
      return this.connection
    }
    this.connection = new Promise<void>((resolve, reject) => {
      this.resolveConnection = resolve
      this.rejectConnection = reject
    })
    const { material } = this.options
    try {
      const remaining = material.outer.expiresAt - Date.now()
      if (!Number.isFinite(remaining) || remaining <= 0) {
        throw failure('Relay admission expired')
      }
      const url = new URL(material.outer.cellUrl)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw failure('Invalid relay endpoint')
      }
      url.protocol = 'wss:'
      url.pathname = `/v1/connect/${encodeURIComponent(material.outer.relayHostId)}`
      this.state = 'handshaking'
      const { clientCapabilities, randomBytes } = this.options
      this.handshake = new HiveAccountRelayHandshake(material, clientCapabilities, randomBytes)
      this.session = this.handshake.session
      const socket = this.options.createSocket(url.toString())
      this.socket = socket
      socket.binaryType = 'arraybuffer'
      this.timer = setTimeout(
        () => this.close(failure('Relay handshake timed out')),
        Math.min(remaining, this.options.handshakeTimeoutMs ?? 27_000)
      )
      socket.onopen = () =>
        this.guard(() =>
          this.send(
            JSON.stringify({
              type: 'relay-auth',
              v: 2,
              clientAdmissionToken: material.outer.clientAdmissionToken,
              clientPublicKeyB64: relayBase64Url(material.clientKeyPair.publicKey)
            })
          )
        )
      socket.onmessage = ({ data }) => this.enqueue(data)
      socket.onerror = () => this.close(failure('Relay connection failed'))
      socket.onclose = (event) => this.close(new HiveAccountRelayClosedError(event.code))
    } catch (error) {
      this.close(error instanceof Error ? error : failure('Relay connection failed'))
    }
    return this.connection
  }

  request(
    request: HiveAccountRelayRequest,
    timeoutMs = 30_000,
    signal?: AbortSignal
  ): Promise<RuntimeRpcResponse<unknown>> {
    try {
      assertRelayRequest(request, this.isReady, this.pending.has(request.id))
    } catch (error) {
      return Promise.reject(error)
    }
    if (this.pending.size >= 64) {
      return Promise.reject(failure('Relay pending request limit reached'))
    }
    return this.pending.request(
      request.id,
      timeoutMs,
      () =>
        this.guard(() => this.send(this.session!.sealText(serializeRemoteRuntimePayload(request)))),
      signal
    )
  }

  subscribe(request: HiveAccountRelayRequest, callbacks: HiveAccountRelaySubscription): () => void {
    assertRelayRequest(request, this.isReady && !this.subscription, this.pending.has(request.id))
    if (this.subscription || this.pending.size) {
      throw failure('Relay stream requires an exclusive channel')
    }
    this.subscription = { id: request.id, callbacks }
    this.guard(() => this.send(this.session!.sealText(serializeRemoteRuntimePayload(request))))
    return () => this.close()
  }

  sendBinary(bytes: Uint8Array): boolean {
    if (!this.isReady || !this.subscription || bytes.byteLength > 8 * 1024 * 1024) {
      return false
    }
    this.guard(() => this.send(this.session!.sealBinary(bytes)))
    return this.isReady
  }

  close(error?: Error): void {
    if (this.isClosed) {
      return
    }
    const intentional = error === undefined
    error ??= failure('Relay connection disposed')
    this.state = 'closed'
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
      if (socket.readyState === 0) {
        socket.onerror = () => undefined
      }
      try {
        socket.close(1000, 'Connection disposed')
      } catch {
        /* Already closed. */
      }
    }
    this.options.material.inner.ticketSecret.fill(0)
    this.options.material.clientKeyPair.secretKey.fill(0)
    this.options.material.outer.clientAdmissionToken = ''
    this.session = null
    this.handshake = null
    this.rejectConnection?.(error)
    this.resolveConnection = this.rejectConnection = null
    this.pending.rejectAll(error)
    const subscription = this.subscription
    this.subscription = null
    try {
      this.options.onClosed?.(error, intentional)
    } finally {
      subscription?.callbacks.onClose?.()
    }
  }

  private send(data: string | Uint8Array): void {
    if (
      !this.socket ||
      this.socket.readyState !== 1 ||
      this.socket.bufferedAmount + relayPayloadBytes(data) > MAX_BUFFER
    ) {
      throw failure('Relay outbound buffer limit reached')
    }
    this.socket.send(data)
  }

  private guard(action: () => void): void {
    if (this.isClosed) {
      return
    }
    try {
      action()
    } catch {
      this.close(failure('Relay protocol failed'))
    }
  }

  private enqueue(data: unknown): void {
    this.guard(() => {
      const bytes = relayPayloadBytes(data)
      if (
        bytes > MAX_FRAME ||
        this.incomingBytes + bytes > MAX_BUFFER ||
        this.incomingCount >= 32
      ) {
        throw failure('Relay inbound buffer limit reached')
      }
      this.incomingBytes += bytes
      this.incomingCount++
      this.incoming = this.incoming
        .then(async () => {
          try {
            if (!this.isClosed) {
              await this.receive(data)
            }
          } finally {
            this.incomingBytes -= bytes
            this.incomingCount--
          }
        })
        .catch(() => this.close(failure('Invalid relay frame')))
    })
  }

  private async receive(data: unknown): Promise<void> {
    const session = this.session!
    if (this.state === 'handshaking') {
      if (this.handshake!.accept(data, (frame) => this.send(frame))) {
        this.state = 'connected'
        if (this.timer) {
          clearTimeout(this.timer)
        }
        this.timer = null
        this.resolveConnection?.()
        this.resolveConnection = this.rejectConnection = null
      }
      return
    }
    if (typeof data !== 'string') {
      if (!this.isReady || !this.subscription) {
        throw failure('Unexpected relay binary frame')
      }
      const bytes = await relayBinary(data)
      if (this.isClosed) {
        return
      }
      const plaintext = session.openBinary(bytes)
      if (!plaintext) {
        throw failure('Invalid encrypted relay frame')
      }
      this.subscription?.callbacks.onBinary?.(plaintext)
      return
    }
    const plaintext = session.openText(data)
    if (plaintext === null) {
      throw failure('Invalid encrypted relay frame')
    }
    const parsed = parseRemoteRuntimeRpcFrame(plaintext)
    if (parsed.type === 'error') {
      throw parsed.error
    }
    if (parsed.type === 'keepalive') {
      return
    }
    const response = parsed.response
    if (!response.ok && response.error.code === 'unauthorized') {
      throw failure('Runtime authorization expired')
    }
    if (this.subscription?.id === response.id) {
      this.subscription.callbacks.onResponse(response)
      if (!response.ok || (response.result as { type?: unknown } | null)?.type === 'end') {
        this.close()
      }
      return
    }
    this.pending.resolve(response)
  }
}
