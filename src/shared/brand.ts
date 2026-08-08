import { hivecodeProductConfig } from './generated/product-config'

/** Stable product-identity adapter for callers that should not read manifest files directly. */
export const PRODUCT_CONFIG = hivecodeProductConfig
export const APP_DISPLAY_NAME = hivecodeProductConfig.displayName
export const APP_SHORT_NAME = hivecodeProductConfig.shortName
export const PRIMARY_CLI_COMMAND = hivecodeProductConfig.cli.primary
export const CLI_COMPATIBILITY_ALIASES = hivecodeProductConfig.cli.aliases
export const PRIMARY_SCHEME = hivecodeProductConfig.schemes.primary
export const SCHEME_COMPATIBILITY_ALIASES = hivecodeProductConfig.schemes.aliases
