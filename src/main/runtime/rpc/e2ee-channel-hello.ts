import type { E2EEAccountBinding } from './e2ee-channel-account-authentication'
import { parseRemoteRuntimeJsonText } from '../../../shared/remote-runtime-request-frames'
import {
  DesktopMobileE2EEV2Session,
  type DesktopMobileE2EEV2Context
} from './mobile-e2ee-v2-desktop-session'

type HelloResult =
  | {
      ok: true
      ready: unknown
      accountBinding: E2EEAccountBinding
      v2Session: DesktopMobileE2EEV2Session
    }
  | { ok: false; reason: string }

export function resolveE2EEChannelHello(args: {
  raw: string
  serverSecretKey: Uint8Array
  transportContext: DesktopMobileE2EEV2Context
}): HelloResult {
  let hello: Record<string, unknown>
  try {
    hello = parseRemoteRuntimeJsonText(args.raw) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'Invalid handshake message' }
  }

  if (!hello || typeof hello !== 'object' || Array.isArray(hello)) {
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
          v2Session,
          accountBinding: {
            clientPublicKeyB64: hello.clientPublicKeyB64 as string,
            transcriptHashB64: v2Session.transcriptHashB64
          }
        }
      : { ok: false, reason: 'Invalid e2ee_hello v2' }
  }
  return { ok: false, reason: 'Invalid E2EE handshake' }
}
