import { hivecodeProductConfig } from './generated/product-config'

export const APP_DISPLAY_NAME = hivecodeProductConfig.displayName
export const PRODUCT_PUBLIC_LINKS = hivecodeProductConfig.publicLinks
export const PRODUCT_SOURCE_REPOSITORY = hivecodeProductConfig.desktop.starRepository
export const PRODUCT_SOURCE_REPOSITORY_URL = PRODUCT_SOURCE_REPOSITORY
  ? `https://github.com/${PRODUCT_SOURCE_REPOSITORY}`
  : null

const UPSTREAM_VISIBLE_BRAND_PATTERN = /\b(?:ORCA|Orca)\b(?!\.(?:YAML|yaml)\b)/g

/**
 * Applies the product name only to standalone user-visible upstream brand words.
 * Lower-case paths, schemes, environment variables, and composed compatibility
 * identifiers remain unchanged.
 */
export function productNameText(value: string): string {
  return value.replace(UPSTREAM_VISIBLE_BRAND_PATTERN, APP_DISPLAY_NAME)
}
