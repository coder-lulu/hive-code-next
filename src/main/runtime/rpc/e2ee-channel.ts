// Why: this channel keeps E2EE framing out of RPC handlers, which consume plaintext across transports.
import type { WebSocket } from 'ws'
import { encrypt, decrypt, encryptBytes, decryptBytes } from './e2ee-crypto'
import type {
  DesktopMobileE2EEV2Session,
  DesktopMobileE2EEV2Context
} from './mobile-e2ee-v2-desktop-session'
import type { DesktopMobileE2EEV2OutboundItem as V2OutboundItem } from './mobile-e2ee-v2-desktop-outbound'
import { handleDesktopMobileE2EEV2Inbound } from './mobile-e2ee-v2-desktop-inbound'
import {
  isMobileE2EEBinaryPayloadWithinLimit,
  isMobileE2EEOutboundItemWithinLimit,
  isMobileE2EETextPayloadWithinLimit
} from './mobile-e2ee-outbound-admission'
import type { MobileE2EEOutboundMemoryBudget } from './mobile-e2ee-outbound-memory-budget'
import { MobileE2EEDesktopOutboundOwner } from './mobile-e2ee-desktop-outbound-owner'
import type { RuntimeCapability } from '../../../shared/protocol-version'
import {
  authenticateE2EEChannel,
  rejectE2EEAuthentication,
  type E2EEAuthenticatedCloudSession,
  type E2EEAuthenticatedDevice,
  type E2EECloudManagedSessionResolver
} from './e2ee-channel-authentication'
import { resolveE2EEChannelHello } from './e2ee-channel-hello'
import {
  reportE2EEOutboundBudgetClose,
  type OutboundBudgetEmitter
} from './e2ee-channel-budget-close'

export type {
  E2EEAuthenticatedCloudSession,
  E2EEAuthenticatedDevice
} from './e2ee-channel-authentication'

const HANDSHAKE_TIMEOUT_MS = 10_000
const MAX_CONSECUTIVE_DECRYPT_FAILURES = 5

export type E2EEChannelOptions = {
  serverSecretKey: Uint8Array
  resolveAuthenticatedDevice: (token: string) => E2EEAuthenticatedDevice | null
  onReady: (channel: E2EEChannel, device: E2EEAuthenticatedDevice) => void
  resolveCloudManagedSession?: E2EECloudManagedSessionResolver
  onCloudReady?: (channel: E2EEChannel, principal: E2EEAuthenticatedCloudSession) => void
  onError: (
    code: number,
    reason: string,
    principalKind?: 'paired_device' | 'cloud_managed_web_session'
  ) => void
  transportContext?: DesktopMobileE2EEV2Context
  requireV2?: boolean
  outboundMemoryBudget?: MobileE2EEOutboundMemoryBudget
}

export class E2EEChannel {
  private state: 'awaiting_hello' | 'awaiting_auth' | 'ready' = 'awaiting_hello'
  private sharedKey: Uint8Array | null = null
  private consecutiveFailures = 0
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly ws: WebSocket
  private readonly serverSecretKey: Uint8Array
  private readonly resolveAuthenticatedDevice: (token: string) => E2EEAuthenticatedDevice | null
  private readonly onReady: (channel: E2EEChannel, device: E2EEAuthenticatedDevice) => void
  private readonly resolveCloudManagedSession: E2EECloudManagedSessionResolver | undefined
  private readonly onCloudReady:
    | ((channel: E2EEChannel, principal: E2EEAuthenticatedCloudSession) => void)
    | undefined
  private readonly onError: E2EEChannelOptions['onError']
  private readonly transportContext: DesktopMobileE2EEV2Context
  private readonly requireV2: boolean
  private readonly outbound: MobileE2EEDesktopOutboundOwner
  private v2Session: DesktopMobileE2EEV2Session | null = null
  // Why: the handler is set after readiness because its reply closure needs this channel's encryption state.
  private messageHandler:
    | ((
        plaintext: string,
        encryptedReply: (response: string) => void,
        encryptedBinaryReply: (response: Uint8Array<ArrayBufferLike>) => boolean | void
      ) => void)
    | null = null
  private binaryMessageHandler: ((plaintext: Uint8Array<ArrayBufferLike>) => void) | null = null

  deviceToken: string | null = null
  authenticatedDevice: E2EEAuthenticatedDevice | null = null
  authenticatedCloudSession: E2EEAuthenticatedCloudSession | null = null
  clientCapabilities: readonly RuntimeCapability[] = []

  constructor(ws: WebSocket, options: E2EEChannelOptions) {
    this.ws = ws
    this.serverSecretKey = options.serverSecretKey
    this.resolveAuthenticatedDevice = options.resolveAuthenticatedDevice
    this.onReady = options.onReady
    this.resolveCloudManagedSession = options.resolveCloudManagedSession
    this.onCloudReady = options.onCloudReady
    this.onError = options.onError
    this.transportContext = options.transportContext ?? { transport: 'direct' }
    this.requireV2 = options.requireV2 ?? false
    this.outbound = new MobileE2EEDesktopOutboundOwner(ws, options.outboundMemoryBudget)

    this.handshakeTimer = setTimeout(() => {
      this.onError(4002, 'E2EE handshake timeout')
    }, HANDSHAKE_TIMEOUT_MS)
  }

  onMessage(
    handler: (
      plaintext: string,
      encryptedReply: (response: string) => void,
      encryptedBinaryReply: (response: Uint8Array<ArrayBufferLike>) => boolean | void
    ) => void
  ): void {
    this.messageHandler = handler
  }

  onBinaryMessage(handler: (plaintext: Uint8Array<ArrayBufferLike>) => void): void {
    this.binaryMessageHandler = handler
  }

  handleRawMessage(raw: string | Uint8Array<ArrayBufferLike>): void {
    if (this.state === 'awaiting_hello') {
      if (typeof raw !== 'string') {
        this.onError(4001, 'Invalid handshake message')
        return
      }
      this.handleHello(raw)
      return
    }

    if (this.v2Session) {
      this.handleV2RawMessage(raw)
      return
    }
    const sharedKey = this.sharedKey
    if (!sharedKey) {
      return
    }

    if (typeof raw !== 'string') {
      const plaintextBytes = decryptBytes(raw, sharedKey)
      if (plaintextBytes === null) {
        this.trackDecryptFailure()
        return
      }
      this.consecutiveFailures = 0
      if (this.state !== 'ready') {
        this.onError(4001, 'Invalid binary message before authentication')
        return
      }
      this.binaryMessageHandler?.(plaintextBytes)
      return
    }

    const plaintext = decrypt(raw, sharedKey)
    if (plaintext === null) {
      this.trackDecryptFailure()
      return
    }

    this.consecutiveFailures = 0
    if (this.state === 'awaiting_auth') {
      this.handleAuth(plaintext)
      return
    }

    // Why: streaming emits can outlive destroy(), so late replies must not encrypt with a cleared key.
    const encryptedReply = (response: string) => {
      if (!this.sharedKey || this.ws.readyState !== this.ws.OPEN) {
        return
      }
      if (!isMobileE2EETextPayloadWithinLimit(response)) {
        this.closeForOutboundBudget('size')
        return
      }
      this.outbound.enqueueLegacyText(
        encrypt(response, this.sharedKey),
        () => Boolean(this.sharedKey),
        () => this.closeForOutboundBudget('queue')
      )
    }
    const encryptedBinaryReply = (response: Uint8Array<ArrayBufferLike>): boolean => {
      if (!this.sharedKey || this.ws.readyState !== this.ws.OPEN) {
        return false
      }
      if (!isMobileE2EEBinaryPayloadWithinLimit(response)) {
        this.closeForOutboundBudget('size')
        return false
      }
      if (!this.outbound.canSend(response.byteLength + 40)) {
        return false
      }
      this.ws.send(Buffer.from(encryptBytes(response, this.sharedKey)), { binary: true })
      return true
    }
    this.messageHandler?.(plaintext, encryptedReply, encryptedBinaryReply)
  }

  private trackDecryptFailure(): void {
    // Why: a wrong key cannot recover on this socket; close so the client uses its bounded auth retry budget.
    if (this.state === 'awaiting_auth') {
      this.onError(4001, 'Unauthorized')
    } else if (++this.consecutiveFailures >= MAX_CONSECUTIVE_DECRYPT_FAILURES) {
      this.onError(4003, 'Too many decryption failures')
    }
  }

  private handleHello(raw: string): void {
    const result = resolveE2EEChannelHello({
      raw,
      serverSecretKey: this.serverSecretKey,
      transportContext: this.transportContext,
      requireV2: this.requireV2
    })
    if (!result.ok) {
      this.onError(4001, result.reason)
      return
    }
    this.sharedKey = result.sharedKey
    this.v2Session = result.v2Session
    this.state = 'awaiting_auth'
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(result.ready))
    }
  }

  private handleAuth(plaintext: string): void {
    const authentication = authenticateE2EEChannel({
      plaintext,
      v2Session: this.v2Session,
      resolveDevice: this.resolveAuthenticatedDevice,
      resolveCloudSession: this.resolveCloudManagedSession
    })
    if (!authentication.ok) {
      rejectE2EEAuthentication(
        authentication.code,
        authentication.principalKind,
        (message) => this.sendEncryptedControl(message),
        this.onError
      )
      return
    }
    this.clientCapabilities = authentication.clientCapabilities
    if (authentication.principalKind === 'cloud_managed_web_session') {
      this.authenticatedCloudSession = authentication.principal
      this.completeAuthentication(() => this.onCloudReady?.(this, authentication.principal))
    } else {
      this.deviceToken = authentication.principal.deviceToken
      this.authenticatedDevice = authentication.principal
      this.completeAuthentication(() => this.onReady(this, authentication.principal))
    }
  }

  private completeAuthentication(onReady: () => void): void {
    this.state = 'ready'
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
    // Why: bind the resolved principal before the peer can observe authentication success.
    onReady()
    this.sendEncryptedControl(
      this.v2Session
        ? {
            type: 'e2ee_authenticated',
            v: 2,
            transcriptHashB64: this.v2Session.transcriptHashB64
          }
        : { type: 'e2ee_authenticated' }
    )
  }

  private handleV2RawMessage(raw: string | Uint8Array<ArrayBufferLike>): void {
    handleDesktopMobileE2EEV2Inbound({
      session: this.v2Session!,
      raw,
      awaitingAuth: this.state === 'awaiting_auth',
      onDecryptFailure: () => this.trackDecryptFailure(),
      onDecryptSuccess: () => (this.consecutiveFailures = 0),
      onAuth: (plaintext) => this.handleAuth(plaintext),
      onBinary: (plaintext) => this.binaryMessageHandler?.(plaintext),
      onText: (plaintext) =>
        this.messageHandler?.(
          plaintext,
          (response) => this.enqueueV2({ kind: 'text', plaintext: response }),
          (response) => this.enqueueV2({ kind: 'binary', plaintext: response })
        ),
      onProtocolError: () => this.onError(4001, 'Invalid binary message before authentication')
    })
  }

  private enqueueV2(item: V2OutboundItem): boolean {
    if (!this.v2Session || this.ws.readyState !== this.ws.OPEN) {
      return false
    }
    if (!isMobileE2EEOutboundItemWithinLimit(item)) {
      this.closeForOutboundBudget('size')
      return false
    }
    return this.outbound.enqueueV2(item, this.v2Session, () => this.closeForOutboundBudget('queue'))
  }

  private closeForOutboundBudget(emitter: OutboundBudgetEmitter): void {
    reportE2EEOutboundBudgetClose(emitter, this.onError)
  }

  private sendEncryptedControl(message: unknown): void {
    if (this.v2Session) {
      this.enqueueV2({ kind: 'text', plaintext: JSON.stringify(message) })
    } else if (this.ws.readyState === this.ws.OPEN && this.sharedKey) {
      const frame = encrypt(JSON.stringify(message), this.sharedKey)
      this.outbound.sendLegacyFrame(frame, () => this.closeForOutboundBudget('queue'))
    }
  }

  destroy(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
    this.sharedKey = null
    this.authenticatedDevice = null
    this.v2Session = null
    this.messageHandler = null
    this.binaryMessageHandler = null
    this.outbound.dispose()
  }
}
