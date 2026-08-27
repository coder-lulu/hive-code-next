import { hivecodeProductConfig } from './generated/product-config'

/** Stable product-identity adapter for callers that should not read manifest files directly. */
export const PRODUCT_CONFIG = hivecodeProductConfig
export const APP_DISPLAY_NAME = hivecodeProductConfig.displayName
export const APP_SHORT_NAME = hivecodeProductConfig.shortName

const UPSTREAM_VISIBLE_BRAND_PATTERN = /\b(?:ORCA|Orca)\b/g

/**
 * Rewrites only standalone upstream product names in user-visible copy.
 *
 * Compatibility identifiers are intentionally lowercase or embedded in a
 * larger token (`orca.yaml`, `ORCA_CLOUD_API_URL`, `OrcaProfile`, `orca://`).
 * The two legacy protocol/config spellings that use standalone capitals are
 * preserved explicitly without weakening the general user-visible boundary.
 */
export function applyProductBranding(value: string): string {
  return value.replace(UPSTREAM_VISIBLE_BRAND_PATTERN, (match, offset: number) => {
    const suffix = value.slice(offset + match.length)
    const previousCharacter = value[offset - 1]
    const nextCharacter = suffix[0]
    const isPathSegment =
      previousCharacter === '/' ||
      previousCharacter === '\\' ||
      nextCharacter === '/' ||
      nextCharacter === '\\'
    if (isPathSegment || suffix.toLowerCase().startsWith('.yaml') || suffix.startsWith('://')) {
      return match
    }
    return APP_DISPLAY_NAME
  })
}

export const PRIMARY_CLI_COMMAND = hivecodeProductConfig.cli.primary
export const CLI_COMPATIBILITY_ALIASES = hivecodeProductConfig.cli.aliases
export const PRIMARY_SCHEME = hivecodeProductConfig.schemes.primary
export const SCHEME_COMPATIBILITY_ALIASES = hivecodeProductConfig.schemes.aliases
