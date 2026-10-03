import { sha256 } from './sha256'

const SALT_LABEL = new TextEncoder().encode('orca-mobile-e2ee/v2/salt\0')
const INFO_LABEL = new TextEncoder().encode('orca-mobile-e2ee/v2/session\0')

export function deriveMobileE2EEV2KeySchedule(args: {
  sharedSecret: Uint8Array
  transcript: Uint8Array
  clientNonce: Uint8Array
  desktopNonce: Uint8Array
}): {
  mobileToDesktopKey: Uint8Array
  desktopToMobileKey: Uint8Array
  sessionId: Uint8Array
  transcriptHash: Uint8Array
} {
  requireLength(args.sharedSecret, 32, 'shared secret')
  requireLength(args.clientNonce, 32, 'client nonce')
  requireLength(args.desktopNonce, 32, 'desktop nonce')

  const transcriptHash = sha256(args.transcript)
  const salt = sha256(concatBytes([SALT_LABEL, args.clientNonce, args.desktopNonce]))
  const info = concatBytes([INFO_LABEL, transcriptHash])
  const prk = hmac(salt, args.sharedSecret)
  const first = hmac(prk, concatBytes([info, new Uint8Array([1])]))
  const second = hmac(prk, concatBytes([first, info, new Uint8Array([2])]))
  const third = hmac(prk, concatBytes([second, info, new Uint8Array([3])]))
  const expanded = concatBytes([first, second, third])
  return {
    mobileToDesktopKey: expanded.slice(0, 32),
    desktopToMobileKey: expanded.slice(32, 64),
    sessionId: expanded.slice(64, 96),
    transcriptHash
  }
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function requireLength(bytes: Uint8Array, expected: number, label: string): void {
  if (bytes.length !== expected) {
    throw new Error(`Invalid ${label}: expected ${expected} bytes, got ${bytes.length}`)
  }
}

function hmac(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(64)
  block.set(key.length > 64 ? sha256(key) : key)
  const inner = block.map((byte) => byte ^ 0x36)
  const outer = block.map((byte) => byte ^ 0x5c)
  return sha256(concatBytes([outer, sha256(concatBytes([inner, message]))]))
}
