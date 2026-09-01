import { randomBytes, timingSafeEqual } from 'node:crypto'
import nacl from 'tweetnacl'
import {
  encodeMobileE2EEV2Transcript,
  validateMobileE2EEV2Handshake,
  type MobileE2EEV2Hello
} from '../../shared/mobile-e2ee-v2-contract'
import { openMobileE2EEV2Frame, sealMobileE2EEV2Frame } from '../../shared/mobile-e2ee-v2-framing'
import { deriveSharedKey, publicKeyFromBase64, publicKeyToBase64 } from '../../shared/e2ee-crypto'
import { parseRemoteRuntimeJsonText } from '../../shared/remote-runtime-request-frames'
import { deriveMobileE2EEV2KeySchedule } from '../runtime/rpc/mobile-e2ee-v2-key-schedule'
import type { HiveAccountRuntimeConnectionMaterial } from './hive-account-runtime-connection-material'

export class HiveAccountRuntimeClientE2ee {
  readonly hello: MobileE2EEV2Hello
  private schedule: ReturnType<typeof deriveMobileE2EEV2KeySchedule> | null = null
  private inboundCounter = 0n
  private outboundCounter = 0n
  private transcriptHash: string | null = null

  constructor(private readonly material: HiveAccountRuntimeConnectionMaterial) {
    this.hello = {
      type: 'e2ee_hello',
      v: 2,
      clientPublicKeyB64: publicKeyToBase64(material.clientKeyPair.publicKey),
      clientNonceB64: randomBytes(32).toString('base64'),
      capabilities: { framing: [2], payloadKinds: ['text', 'binary'] },
      context: {
        protocol: 'orca-mobile-e2ee',
        initiator: 'mobile',
        responder: 'desktop',
        transport: 'relay',
        relayHostId: material.relay.relayHostId
      }
    }
  }

  acceptReady(raw: string): boolean {
    let ready: unknown
    try {
      ready = parseRemoteRuntimeJsonText(raw)
    } catch {
      return false
    }
    const handshake = validateMobileE2EEV2Handshake(this.hello, ready)
    if (!handshake) {
      return false
    }
    const pinned = publicKeyFromBase64(this.material.runtimePublicKeyB64)
    if (
      pinned.length !== handshake.desktopPublicKey.length ||
      !timingSafeEqual(Buffer.from(pinned), Buffer.from(handshake.desktopPublicKey)) ||
      !hasNonZeroX25519SharedSecret(this.material.clientKeyPair.secretKey, pinned)
    ) {
      return false
    }
    this.schedule = deriveMobileE2EEV2KeySchedule({
      sharedSecret: deriveSharedKey(this.material.clientKeyPair.secretKey, pinned),
      transcript: encodeMobileE2EEV2Transcript(handshake),
      clientNonce: handshake.clientNonce,
      desktopNonce: handshake.desktopNonce
    })
    this.transcriptHash = Buffer.from(this.schedule.transcriptHash).toString('base64')
    return true
  }

  get transcriptHashB64(): string {
    if (!this.transcriptHash) {
      throw new Error('E2EE transcript is unavailable')
    }
    return this.transcriptHash
  }

  isAuthenticated(plaintext: string): boolean {
    try {
      const value = parseRemoteRuntimeJsonText(plaintext) as Record<string, unknown>
      return (
        value.type === 'e2ee_authenticated' &&
        value.v === 2 &&
        value.transcriptHashB64 === this.transcriptHashB64
      )
    } catch {
      return false
    }
  }

  sealText(plaintext: string): string {
    return Buffer.from(this.seal(new TextEncoder().encode(plaintext), 'text')).toString('base64')
  }

  sealBinary(plaintext: Uint8Array): Uint8Array {
    return this.seal(plaintext, 'binary')
  }

  openText(frame: string): string | null {
    const decoded = Buffer.from(frame, 'base64')
    if (decoded.toString('base64') !== frame) {
      return null
    }
    const plaintext = this.open(decoded, 'text')
    return plaintext ? new TextDecoder().decode(plaintext) : null
  }

  openBinary(frame: Uint8Array): Uint8Array | null {
    return this.open(frame, 'binary')
  }

  private seal(payload: Uint8Array, payloadKind: 'text' | 'binary'): Uint8Array {
    if (!this.schedule) {
      throw new Error('E2EE session is not ready')
    }
    const frame = sealMobileE2EEV2Frame({
      payload,
      key: this.schedule.mobileToDesktopKey,
      sessionId: this.schedule.sessionId,
      direction: 'mobile-to-desktop',
      payloadKind,
      counter: this.outboundCounter
    })
    this.outboundCounter++
    return frame
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
}

export function hasNonZeroX25519SharedSecret(
  secretKey: Uint8Array,
  peerPublicKey: Uint8Array
): boolean {
  try {
    return nacl.scalarMult(secretKey, peerPublicKey).some((byte) => byte !== 0)
  } catch {
    return false
  }
}
