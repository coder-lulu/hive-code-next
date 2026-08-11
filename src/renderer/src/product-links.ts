import { PRODUCT_CONFIG } from '../../shared/brand'

function widenNullableString(value: string | null): string | null {
  return value
}

export const PRODUCT_PUBLIC_LINKS = PRODUCT_CONFIG.publicLinks
export const PRODUCT_CHANGELOG_URL = PRODUCT_CONFIG.endpoints.changelog
export const PRODUCT_SOURCE_REPOSITORY = widenNullableString(PRODUCT_CONFIG.desktop.starRepository)
export const PRODUCT_SOURCE_REPOSITORY_URL = PRODUCT_SOURCE_REPOSITORY
  ? `https://github.com/${PRODUCT_SOURCE_REPOSITORY}`
  : null
