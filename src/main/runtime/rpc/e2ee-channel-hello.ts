import type { E2EEAccountBinding } from './e2ee-channel-account-authentication'
import { parseRemoteRuntimeJsonText } from '../../../shared/remote-runtime-request-frames'
import { deriveSharedKey } from './e2ee-crypto'
import { decodeMobileE2EEPublicKey } from './mobile-e2ee-auth-validation'
import {
  DesktopMobileE2EEV2Session,
  type DesktopMobileE2EEV2Context
} from './mobile-e2ee-v2-desktop-session'

type HelloResult =
  | {
      ok: true
      ready: unknown
      sharedKey: Uint8Array | null
      accountBinding: E2EEAccountBinding | null
      v2Session: DesktopMobileE2EEV2Session | null
    }
  | { ok: false; reason: string }

export function resolveE2EEChannelHello(args: {
  raw: string
  serverSecretKey: Uint8Array
  transportContext: DesktopMobileE2EEV2Context
  requireV2: boolean
}): HelloResult {
  let hello: Record<string, unknown>
  try {
    hello = parseRemoteRuntimeJsonText(args.raw) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'Invalid handshake message' }
  }

  if (hello.type === 'e2ee_hello' && hello.v === 2) {
    const v2Session = DesktopMobileE2EEV2Session.create({
      hello,
      serverSecretKey: args.serverSecretKey,
      expectedContext: args.transportContext
    })
    return v2Session
      ? {
          ok: true,
          ready: v2Session.ready,
          sharedKey: null,
          v2Session,
          accountBinding: {
            clientPublicKeyB64: hello.clientPublicKeyB64 as string,
            transcriptHashB64: v2Session.transcriptHashB64
          }
        }
      : { ok: false, reason: 'Invalid e2ee_hello v2' }
  }
  if (args.requireV2) {
    return { ok: false, reason: 'E2EE v2 required' }
  }
  if (hello.type !== 'e2ee_hello' || typeof hello.publicKeyB64 !== 'string') {
    return { ok: false, reason: 'Invalid e2ee_hello' }
  }
  const clientPublicKey = decodeMobileE2EEPublicKey(hello.publicKeyB64)
  return clientPublicKey
    ? {
        ok: true,
        ready: { type: 'e2ee_ready' },
        sharedKey: deriveSharedKey(args.serverSecretKey, clientPublicKey),
        accountBinding: null,
        v2Session: null
      }
    : { ok: false, reason: 'Invalid public key' }
}
