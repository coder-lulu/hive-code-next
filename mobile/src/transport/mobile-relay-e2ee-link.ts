import {
  RelayPhoneHelloSchema,
  type RelayPhoneHello
} from '../../../src/shared/mobile-relay-phone-protocol'
import { MobileE2EEV2ClientSession } from './mobile-e2ee-v2-client-session'
import { MobileE2EEV2PhysicalChannel } from './mobile-e2ee-v2-physical-channel'
import { websocketPayloadToUint8 } from './websocket-payload-bytes'

// Native WebSockets normally emit close immediately after error; bound the
// missing-close case so a dead socket cannot leave recovery pending forever.
const RELAY_ERROR_CLOSE_GRACE_MS = 250

export class RelayOuterError extends Error {
  constructor(readonly code: number) {
    super(`relay_outer_${code}`)
  }
}

type MobileRelayE2eeLinkOptions = {
  endpoint: { cellUrl: string; relayHostId: string }
  credential: string | { readonly ticketId: string; readonly ticketSecret: string }
  expectedCredentialKind: 'invite' | 'resume' | 'ticket'
  deviceToken: string
  desktopPublicKeyB64: string
  clientKeyPair?: { readonly publicKey: Uint8Array; readonly secretKey: Uint8Array }
  onAuthenticated: () => void
  onText: (plaintext: string) => void
  onBinary: (plaintext: Uint8Array) => void
  onHello?: (hello: Extract<RelayConnectionHello, { ok: true }>) => void
  onError: (error: Error) => void
  createSocket?: (url: string) => WebSocket
}

export class MobileRelayE2eeLink {
  private readonly options: MobileRelayE2eeLinkOptions
  private readonly socket: WebSocket
  private readonly channel: MobileE2EEV2PhysicalChannel
  private outerReady = false
  private closed = false
  private transportErrorTimer: ReturnType<typeof setTimeout> | null = null
  private inboundChain: Promise<void> = Promise.resolve()

  constructor(options: MobileRelayE2eeLinkOptions) {
    this.options = options
    this.socket = (options.createSocket ?? ((url) => new WebSocket(url)))(
      relaySocketUrl(options.endpoint)
    )
    const session = MobileE2EEV2ClientSession.create({
      desktopPublicKeyB64: options.desktopPublicKeyB64,
      transport: 'relay',
      relayHostId: options.endpoint.relayHostId,
      clientKeyPair: options.clientKeyPair
    })
    this.channel = new MobileE2EEV2PhysicalChannel({
      session,
      socket: this.socket,
      deviceToken: options.deviceToken,
      decodeBinary: websocketPayloadToUint8,
      onAuthenticated: options.onAuthenticated,
      onText: options.onText,
      onBinary: options.onBinary,
      onError: (error) => this.fail(error)
    })
    this.bindSocket()
  }

  sendText(plaintext: string): boolean {
    return !this.closed && this.channel.sendText(plaintext)
  }

  sendBinary(plaintext: Uint8Array): boolean {
    return !this.closed && this.channel.sendBinary(plaintext)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    if (this.transportErrorTimer) {
      clearTimeout(this.transportErrorTimer)
      this.transportErrorTimer = null
    }
    this.channel.dispose()
    this.socket.close()
  }

  private bindSocket(): void {
    this.socket.onopen = () => {
      if (this.closed) {
        return
      }
      try {
        this.socket.send(
          JSON.stringify({
            type: 'relay-auth',
            v: 1,
            mode: 'connect',
            credential: this.options.credential
          })
        )
      } catch (error) {
        this.fail(asError(error))
      }
    }
    this.socket.onmessage = (event) => {
      this.inboundChain = this.inboundChain
        .then(async () => {
          if (this.closed) {
            return
          }
          if (!this.outerReady) {
            this.acceptHello(event.data)
          } else {
            await this.channel.handleMessage(event.data)
          }
        })
        .catch((error: unknown) => this.fail(asError(error)))
    }
    // `error` is often delivered just before `close`; wait for close so a
    // typed relay code is not replaced by a generic transport error.
    this.socket.onerror = () => {
      if (this.closed) {
        return
      }
      this.transportErrorTimer ??= setTimeout(() => {
        this.transportErrorTimer = null
        this.fail(new RelayOuterError(1006))
      }, RELAY_ERROR_CLOSE_GRACE_MS)
    }
    this.socket.onclose = (event) => {
      if (this.transportErrorTimer) {
        clearTimeout(this.transportErrorTimer)
        this.transportErrorTimer = null
      }
      this.fail(new RelayOuterError(event.code || 1006))
    }
  }

  private acceptHello(raw: unknown): void {
    if (typeof raw !== 'string') {
      throw new Error('expected plaintext relay hello')
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error('invalid relay hello JSON')
    }
    const parsed = parseRelayConnectionHello(value, this.options.expectedCredentialKind)
    if (!parsed.success) {
      throw new Error('invalid relay hello')
    }
    if (!parsed.data.ok) {
      throw new RelayOuterError(parsed.data.code)
    }
    if (parsed.data.credentialKind !== this.options.expectedCredentialKind) {
      throw new Error('relay credential resolved as an unexpected credential kind')
    }
    this.outerReady = true
    this.options.onHello?.(parsed.data)
    if (this.closed) {
      return
    }
    this.channel.start()
  }

  private fail(error: Error): void {
    if (this.closed) {
      return
    }
    this.closed = true
    if (this.transportErrorTimer) {
      clearTimeout(this.transportErrorTimer)
      this.transportErrorTimer = null
    }
    this.channel.dispose()
    this.options.onError(error)
    this.socket.close()
  }
}

type RelayConnectionHello =
  | RelayPhoneHello
  | { type: 'relay-hello'; ok: true; credentialKind: 'ticket'; leaseExpiresAt: number }

function parseRelayConnectionHello(
  value: unknown,
  expectedCredentialKind: MobileRelayE2eeLinkOptions['expectedCredentialKind']
): { success: true; data: RelayConnectionHello } | { success: false } {
  if (expectedCredentialKind !== 'ticket') {
    const parsed = RelayPhoneHelloSchema.safeParse(value)
    return parsed.success ? { success: true, data: parsed.data } : { success: false }
  }
  const failure = RelayPhoneHelloSchema.safeParse(value)
  if (failure.success && !failure.data.ok) {
    return { success: true, data: failure.data }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false }
  }
  const hello = value as Record<string, unknown>
  if (
    Object.keys(hello).sort().join(',') !== 'credentialKind,leaseExpiresAt,ok,type' ||
    hello.type !== 'relay-hello' ||
    hello.ok !== true ||
    hello.credentialKind !== 'ticket' ||
    typeof hello.leaseExpiresAt !== 'number' ||
    !Number.isSafeInteger(hello.leaseExpiresAt) ||
    hello.leaseExpiresAt < 0
  ) {
    return { success: false }
  }
  return { success: true, data: hello as RelayConnectionHello }
}

function relaySocketUrl(endpoint: { cellUrl: string; relayHostId: string }): string {
  const url = new URL(endpoint.cellUrl)
  url.protocol = 'wss:'
  url.pathname = `/v1/connect/${encodeURIComponent(endpoint.relayHostId)}`
  return url.toString()
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
