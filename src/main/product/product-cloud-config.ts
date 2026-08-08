import { hivecodeProductConfig } from '../../shared/generated/product-config'
import {
  getOrcaCloudAuthConfig,
  type OrcaCloudAuthConfig,
  type ProductCloudDefaults
} from '../orca-profiles/profile-cloud-auth-config'

const HIVECODE_CLOUD_DEFAULTS: ProductCloudDefaults = {
  apiBaseUrl: hivecodeProductConfig.endpoints.cloud,
  clientId: hivecodeProductConfig.endpoints.cloud ? 'hivecode-desktop' : null,
  relayDirectorUrl: hivecodeProductConfig.endpoints.relay,
  productLabel: 'HiveCode Cloud'
}

/**
 * HiveCode product-aware cloud auth config.
 *
 * In packaged HiveCode builds this routes through the product manifest
 * instead of falling back to Orca production endpoints.  Dev / unpackaged
 * builds still honour ORCA_CLOUD_* env vars for local development.
 */
export function getProductCloudAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  packaged?: boolean
): { configured: true; config: OrcaCloudAuthConfig } | { configured: false; setupMessage: string } {
  return getOrcaCloudAuthConfig(env, packaged, HIVECODE_CLOUD_DEFAULTS)
}
