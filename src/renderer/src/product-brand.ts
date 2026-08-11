import productLogo from '../../../resources/product-logo.png'

export { APP_DISPLAY_NAME, APP_SHORT_NAME, applyProductBranding } from '../../shared/brand'

/** Renderer-safe brand asset adapter; product UI must not import upstream logo assets directly. */
export const PRODUCT_LOGO_URL = productLogo
