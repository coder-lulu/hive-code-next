import {
  PAIRING_OFFER_VERSION,
  PairingOfferSchema,
  type PairingOffer
} from './mobile-relay-pairing-offer'
import {
  PAIRING_CODE_MAX_CHARACTERS,
  PAIRING_INPUT_MAX_CHARACTERS
} from './mobile-pairing-protocol-limits'
import { hivecodeProductConfig } from './generated/product-config'

export const PRIMARY_PAIRING_SCHEME = hivecodeProductConfig.schemes.primary
const SUPPORTED_PAIRING_PROTOCOLS = new Set<string>(
  [PRIMARY_PAIRING_SCHEME, ...hivecodeProductConfig.schemes.aliases].map((scheme) => `${scheme}:`)
)

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
  // Why: Android camera intents and Expo Router preserve query params more
  // reliably than URL fragments when launching a custom-scheme app.
  return `${PRIMARY_PAIRING_SCHEME}://pair?code=${base64url}`
}

/**
 * Returns the canonical HiveCode deep-link for a pairing URL.
 *
 * Legacy custom schemes remain accepted by the decoder so existing links keep
 * working, but anything rendered or copied back to a user must use the
 * product-owned scheme. Non-pairing URLs are returned unchanged because this
 * helper is not a general-purpose URL migration.
 */
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
    throw new Error(
      `Invalid pairing URL: must use ${PRIMARY_PAIRING_SCHEME}://pair (or a supported legacy scheme) and include a pairing code`
    )
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
  // Why: prefix checks accepted routes like `hivecode://pairing?...`; only the
  // pairing deep-link host may carry runtime auth material.
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

// Why: accept either a supported custom-scheme URL or the bare base64
// string so the mobile paste-pair flow can take whichever the user
// actually copied from desktop.
export function parsePairingCode(input: string): PairingOffer | null {
  if (input.length > PAIRING_INPUT_MAX_CHARACTERS) {
    return null
  }
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  try {
    if (hasSupportedPairingScheme(trimmed)) {
      return decodePairingOffer(trimmed)
    }
    return decodePairingBase64(trimmed)
  } catch {
    return null
  }
}

function hasSupportedPairingScheme(value: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)
  return match ? SUPPORTED_PAIRING_PROTOCOLS.has(`${match[1]?.toLowerCase()}:`) : false
}

function decodePairingBase64(base64url: string): PairingOffer {
  if (
    base64url.length === 0 ||
    base64url.length > PAIRING_CODE_MAX_CHARACTERS ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(base64url)
  ) {
    throw new Error('Invalid pairing code')
  }
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const json =
    typeof Buffer === 'undefined'
      ? new TextDecoder().decode(
          Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
        )
      : Buffer.from(base64, 'base64').toString('utf-8')
  return PairingOfferSchema.parse(JSON.parse(json))
}
