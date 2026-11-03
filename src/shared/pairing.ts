import {
  PAIRING_OFFER_VERSION,
  PairingOfferSchema,
  type PairingOffer
} from './mobile-relay-pairing-offer'
import { normalizePairingBase64 } from './mobile-pairing-base64'
import {
  PAIRING_CODE_MAX_CHARACTERS,
  PAIRING_INPUT_MAX_CHARACTERS
} from './mobile-pairing-protocol-limits'
import { PRODUCT_CONFIG } from './brand'

export const PRIMARY_PAIRING_SCHEME = PRODUCT_CONFIG.schemes.primary
const SUPPORTED_PAIRING_PROTOCOLS = new Set<string>(
  [PRIMARY_PAIRING_SCHEME, ...PRODUCT_CONFIG.schemes.aliases].map((scheme) => `${scheme}:`)
)

export { CANONICAL_RUNTIME_RECORD_ID_PATTERN } from './mobile-relay-pairing-offer'
export { PAIRING_OFFER_VERSION, PairingOfferSchema }
export type { PairingOffer }

export function encodePairingOffer(offer: PairingOffer): string {
  const json = JSON.stringify(PairingOfferSchema.parse(offer))
  const base64url = Buffer.from(json, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  if (base64url.length > PAIRING_CODE_MAX_CHARACTERS) {
    throw new Error('Pairing offer exceeds safe size')
  }
  // Android camera intents and Expo Router retain custom-scheme query parameters more reliably than fragments.
  return `${PRIMARY_PAIRING_SCHEME}://pair?code=${base64url}`
}

export function canonicalizePairingUrl(value: string): string {
  const trimmed = value.trim()
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)
  if (!schemeMatch || !SUPPORTED_PAIRING_PROTOCOLS.has(`${schemeMatch[1]?.toLowerCase()}:`)) {
    return value
  }
  try {
    const parsed = new URL(trimmed)
    if (
      parsed.hostname !== 'pair' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (parsed.pathname !== '' && parsed.pathname !== '/')
    ) {
      return value
    }
  } catch {
    return value
  }
  return `${PRIMARY_PAIRING_SCHEME}://${trimmed.slice(schemeMatch[0].length)}`
}

export function decodePairingOffer(url: string): PairingOffer {
  if (url.length > PAIRING_INPUT_MAX_CHARACTERS) {
    throw new Error('Invalid pairing URL: pairing code exceeds safe size')
  }
  const code = extractPairingCodeFromUrl(url)
  if (!code) {
    throw new Error('Invalid pairing URL: expected a supported pairing scheme and code')
  }
  return decodePairingBase64(code)
}

function extractPairingCodeFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Exact pairing host prevents prefix matches such as orca://pairing from carrying runtime credentials.
  if (
    !SUPPORTED_PAIRING_PROTOCOLS.has(parsed.protocol) ||
    parsed.hostname !== 'pair' ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    return null
  }
  if (parsed.pathname !== '' && parsed.pathname !== '/') {
    return null
  }
  const code = parsed.searchParams.get('code')
  if (code) {
    return code
  }
  return parsed.hash ? parsed.hash.slice(1) || null : null
}

// Mobile paste accepts either the copied deep link or bare base64 code.
export function parsePairingCode(input: string): PairingOffer | null {
  if (input.length > PAIRING_INPUT_MAX_CHARACTERS) {
    return null
  }
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      return decodePairingOffer(trimmed)
    }
    return decodePairingBase64(trimmed)
  } catch {
    return null
  }
}

function decodePairingBase64(base64url: string): PairingOffer {
  const base64 = normalizePairingBase64(base64url)
  const json =
    typeof Buffer === 'undefined'
      ? new TextDecoder().decode(
          Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
        )
      : Buffer.from(base64, 'base64').toString('utf-8')
  return PairingOfferSchema.parse(JSON.parse(json))
}
