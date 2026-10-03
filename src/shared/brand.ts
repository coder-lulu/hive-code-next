import { hivecodeProductConfig } from './generated/product-config'

/** Stable product-identity adapter for callers that should not read manifest files directly. */
export const PRODUCT_CONFIG = hivecodeProductConfig
export const APP_DISPLAY_NAME = hivecodeProductConfig.displayName
export const APP_SHORT_NAME = hivecodeProductConfig.shortName
/** Historical display names accepted only while reading user-authored or persisted legacy text. */
export const LEGACY_APP_DISPLAY_NAMES = ['Orca'] as const

const UPSTREAM_VISIBLE_BRAND_PATTERN = /\b(?:ORCA|Orca)\b/g
const LEGACY_CLI_COMMAND_PATTERN = new RegExp(
  `(^|[\\s\`$])(?:${hivecodeProductConfig.cli.aliases
    .map((command) => command.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'))
    .sort((left, right) => right.length - left.length)
    .join('|')})(?=(?:[\\s\`'".,;!?)]|$))`,
  'gm'
)

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

/** Rewrites legacy command examples at user-visible CLI and translation boundaries. */
export function applyProductCliBranding(value: string): string {
  const withCommand = value.replace(
    LEGACY_CLI_COMMAND_PATTERN,
    (match, prefix: string, offset: number) => {
      const command = match.slice(prefix.length)
      const suffix = value.slice(offset + match.length)
      // `orca.yaml` remains a published compatibility filename. Public CLI
      // copy should use `hive`, but must never advertise a file that does not
      // exist just because the command appears before a dot.
      if (command === 'orca' && suffix.toLowerCase().startsWith('.yaml')) {
        return match
      }
      return `${prefix}${hivecodeProductConfig.cli.primary}`
    }
  )
  return applyProductBranding(withCommand)
}

/**
 * Normalizes a CLI executable identity without rewriting arbitrary runtime text.
 * Unknown command names are preserved because they can be development launchers
 * or user-managed wrappers rather than legacy product aliases.
 */
export function getProductCliDisplayCommand(commandName: string): string {
  return commandName === hivecodeProductConfig.cli.primary ||
    hivecodeProductConfig.cli.aliases.some((alias) => alias === commandName)
    ? hivecodeProductConfig.cli.primary
    : commandName
}

/**
 * Brands static translation resources before i18next interpolates runtime data.
 * Do not apply this helper to a completed translation: interpolation values may
 * contain legitimate legacy repository names, URLs, terminal output, or paths.
 */
export function applyProductCliBrandingToCatalog<T>(value: T): T {
  if (typeof value === 'string') {
    return applyProductCliBranding(value) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyProductCliBrandingToCatalog(item)) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, applyProductCliBrandingToCatalog(item)])
    ) as T
  }
  return value
}

export const PRIMARY_CLI_COMMAND = hivecodeProductConfig.cli.primary
export const CLI_COMPATIBILITY_ALIASES = hivecodeProductConfig.cli.aliases
export const PRIMARY_SCHEME = hivecodeProductConfig.schemes.primary
export const SCHEME_COMPATIBILITY_ALIASES = hivecodeProductConfig.schemes.aliases
