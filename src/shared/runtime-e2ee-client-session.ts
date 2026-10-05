import { encodeBase64Bytes, decodeBase64Bytes } from './base64-byte-codec'
import nacl from 'tweetnacl'
import type { RuntimeCapability } from './protocol-version'
import {
  encodeMobileE2EEV2Transcript,
  validateMobileE2EEV2Handshake,
  type MobileE2EETransport,
  type MobileE2EEV2Hello
} from './mobile-e2ee-v2-contract'
import { openMobileE2EEV2Frame, sealMobileE2EEV2Frame } from './mobile-e2ee-v2-framing'
import { deriveMobileE2EEV2KeySchedule } from './runtime-e2ee-key-schedule'

export class RuntimeE2EEClientSession {
  readonly hello: MobileE2EEV2Hello
  private inboundCounter = 0n
  private outboundCounter = 0n
  private schedule: ReturnType<typeof deriveMobileE2EEV2KeySchedule> | null = null
  private transcriptHashB64Value: string | null = null

  private constructor(
    private readonly clientSecretKey: Uint8Array,
    private readonly pinnedDesktopPublicKey: Uint8Array,
    hello: MobileE2EEV2Hello
  ) {
    this.hello = hello
  }

  static create(args: {
    desktopPublicKeyB64: string
    transport: MobileE2EETransport
    relayHostId?: string
    randomBytes?: (length: number) => Uint8Array
    clientNonce?: Uint8Array
    clientKeyPair?: { publicKey: Uint8Array; secretKey: Uint8Array }
  }): RuntimeE2EEClientSession {
    const randomBytes =
      args.randomBytes ??
      ((length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length)))
    const keyPair = args.clientKeyPair ?? nacl.box.keyPair.fromSecretKey(randomBytes(32))
    const clientNonce = args.clientNonce ?? randomBytes(32)
    if (clientNonce.length !== 32) {
      throw new Error(`Invalid client nonce length: ${clientNonce.length}`)
    }
    return new RuntimeE2EEClientSession(
      keyPair.secretKey,
      decodePublicKey(args.desktopPublicKeyB64),
      {
        type: 'e2ee_hello',
        v: 2,
        clientPublicKeyB64: encodeBase64(keyPair.publicKey),
        clientNonceB64: encodeBase64(clientNonce),
        capabilities: { framing: [2], payloadKinds: ['text', 'binary'] },
        context: {
          protocol: 'orca-mobile-e2ee',
          initiator: 'mobile',
          responder: 'desktop',
          transport: args.transport,
          ...(args.relayHostId ? { relayHostId: args.relayHostId } : {})
        }
      }
    )
  }

  acceptReady(ready: unknown): boolean {
    if (this.schedule) {
      return false
    }
    const handshake = validateMobileE2EEV2Handshake(this.hello, ready)
    if (!handshake || !equalBytes(handshake.desktopPublicKey, this.pinnedDesktopPublicKey)) {
      return false
    }
    if (
      !nacl.scalarMult(this.clientSecretKey, this.pinnedDesktopPublicKey).some((byte) => byte !== 0)
    ) {
      return false
    }
    this.schedule = deriveMobileE2EEV2KeySchedule({
      sharedSecret: nacl.box.before(this.pinnedDesktopPublicKey, this.clientSecretKey),
      transcript: encodeMobileE2EEV2Transcript(handshake),
      clientNonce: handshake.clientNonce,
      desktopNonce: handshake.desktopNonce
    })
    this.transcriptHashB64Value = encodeBase64(this.schedule.transcriptHash)
    return true
  }

  get transcriptHashB64(): string {
    if (!this.transcriptHashB64Value) {
      throw new Error('E2EE v2 ready has not been accepted')
    }
    return this.transcriptHashB64Value
  }

  authMessage(deviceToken: string, clientCapabilities: readonly RuntimeCapability[] = []): string {
    return JSON.stringify({
      type: 'e2ee_auth',
      v: 2,
      deviceToken,
      transcriptHashB64: this.transcriptHashB64,
      clientCapabilities
    })
  }

  isAuthenticated(plaintext: string): boolean {
    try {
      const value = JSON.parse(plaintext)
      return (
        value?.type === 'e2ee_authenticated' &&
        value.v === 2 &&
        value.transcriptHashB64 === this.transcriptHashB64
      )
    } catch {
      return false
    }
  }

  openText(frameB64: string): string | null {
    if (frameB64.length > Math.ceil((4 * 1024 * 1024 + 82) / 3) * 4) {
      return null
    }
    const frame = decodeCanonicalBase64(frameB64)
    if (!frame) {
      return null
    }
    const plaintext = this.open(frame, 'text')
    return plaintext ? new TextDecoder().decode(plaintext) : null
  }

  openBinary(frame: Uint8Array): Uint8Array | null {
    return this.open(frame, 'binary')
  }

  sealText(plaintext: string): string {
    return encodeBase64(this.seal(new TextEncoder().encode(plaintext), 'text'))
  }

  sealBinary(plaintext: Uint8Array): Uint8Array {
    return this.seal(plaintext, 'binary')
  }

  private open(frame: Uint8Array, payloadKind: 'text' | 'binary'): Uint8Array | null {
    if (!this.schedule) {
      return null
    }
    const plaintext = openMobileE2EEV2Frame({
      frame,
      key: this.schedule.desktopToMobileKey,
      sessionId: this.schedule.sessionId,
      direction: 'desktop-to-mobile',
      payloadKind,
      expectedCounter: this.inboundCounter
    })
    if (plaintext) {
      this.inboundCounter++
    }
    return plaintext
  }

  private seal(plaintext: Uint8Array, payloadKind: 'text' | 'binary'): Uint8Array {
    if (!this.schedule) {
      throw new Error('E2EE v2 ready has not been accepted')
    }
    const frame = sealMobileE2EEV2Frame({
      payload: plaintext,
      key: this.schedule.mobileToDesktopKey,
      sessionId: this.schedule.sessionId,
      direction: 'mobile-to-desktop',
      payloadKind,
      counter: this.outboundCounter
    })
    this.outboundCounter++
    return frame
  }
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  return encodeBase64Bytes(bytes)
}

function decodeCanonicalBase64(value: string): Uint8Array | null {
  try {
    if (typeof Buffer !== 'undefined') {
      const bytes = Buffer.from(value, 'base64')
      return bytes.toString('base64') === value ? new Uint8Array(bytes) : null
    }
    const bytes = decodeBase64Bytes(value)
    return encodeBase64(bytes) === value ? bytes : null
  } catch {
    return null
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < left.length; index++) {
    difference |= left[index]! ^ right[index]!
  }
  return difference === 0
}

function decodePublicKey(value: string): Uint8Array {
  const key = value.length === 44 ? decodeCanonicalBase64(value) : null
  if (!key || key.length !== 32) {
    throw new Error('Invalid public key')
  }
  return key
}
