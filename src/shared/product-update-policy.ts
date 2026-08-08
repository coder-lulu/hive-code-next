import { hivecodeProductConfig } from './generated/product-config'
import { resolveProductUpdateSource } from './product-update-source'

type ProductUpdateConfig = Pick<typeof hivecodeProductConfig, 'desktop' | 'endpoints'>

export function hasConfiguredProductUpdateChannel(
  config: ProductUpdateConfig = hivecodeProductConfig
): boolean {
  return resolveProductUpdateSource(config) !== null
}
