import { hivecodeProductConfig } from '../generated/product-config'
import { PairingOfferSchema, type PairingOffer } from './types'

const SUPPORTED_PAIRING_SCHEMES = new Set<string>([
  hivecodeProductConfig.schemes.primary,
  ...hivecodeProductConfig.schemes.aliases
])

// Why: this file mirrors src/shared/pairing.ts (which is covered by CI
// vitest) but uses atob/btoa because Metro/Hermes don't ship Node's
// Buffer. Keep the parsing semantics in sync — when one changes, update
// the other.

export function decodePairingUrl(url: string): PairingOffer | null {
  try {
    const code = extractPairingCodeFromUrl(url)
    if (!code) {
      return null
    }
    return decodePairingBase64(code)
  } catch {
    return null
  }
}

// Why: system camera apps hand us the raw custom-scheme URL. Keeping
// extraction here makes QR scan, paste, and external deep-link flows
// accept the same URL shapes.
export function extractPairingCodeFromUrl(url: string): string | null {
  const trimmed = url.trim()
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)?/i.exec(trimmed)
  if (!match || !SUPPORTED_PAIRING_SCHEMES.has(match[1]?.toLowerCase() ?? '')) {
    return null
  }
  const host = match[2]?.toLowerCase()
  const pathname = match[3] ?? ''
  if (host !== 'pair' || (pathname !== '' && pathname !== '/')) {
    return null
  }

  const rest = trimmed.slice(match[0].length)
  const queryIndex = rest.indexOf('?')
  if (queryIndex !== -1) {
    const query = rest.slice(queryIndex + 1).split('#')[0] ?? ''
    const params = new URLSearchParams(query)
    const code = params.get('code')
    if (code) {
      return code
    }
  }
  const hashIndex = rest.indexOf('#')
  if (hashIndex !== -1) {
    return rest.slice(hashIndex + 1) || null
  }
  return null
}

// Why: accept either a supported custom-scheme URL or the bare base64
// string so the paste-pair flow can take whichever the user actually
// copied from desktop.
export function parsePairingCode(input: string): PairingOffer | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  try {
    if (hasSupportedPairingScheme(trimmed)) {
      return decodePairingUrl(trimmed)
    }
    return decodePairingBase64(trimmed)
  } catch {
    return null
  }
}

function hasSupportedPairingScheme(value: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)
  return match ? SUPPORTED_PAIRING_SCHEMES.has(match[1]?.toLowerCase() ?? '') : false
}

function decodePairingBase64(base64url: string): PairingOffer {
  // Why: desktop intentionally strips base64 padding from QR payloads. Some
  // mobile JS runtimes reject unpadded atob input, so restore it before decode.
  const base64 = padBase64(base64url.replace(/-/g, '+').replace(/_/g, '/'))
  const json = atob(base64)
  return PairingOfferSchema.parse(JSON.parse(json))
}

function padBase64(base64: string): string {
  const remainder = base64.length % 4
  if (remainder === 0) {
    return base64
  }
  return `${base64}${'='.repeat(4 - remainder)}`
}
