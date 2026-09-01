import { hivecodeProductConfig } from '../../shared/generated/product-config'
import {
  getOrcaCloudAuthConfig,
  type OrcaCloudAuthConfig,
  type ProductCloudDefaults
} from '../orca-profiles/profile-cloud-auth-config'

const HIVECODE_CLOUD_DEFAULTS: ProductCloudDefaults = {
  apiBaseUrl: hivecodeProductConfig.services.api.baseUrl,
  clientId: hivecodeProductConfig.services.identity.clients.desktop,
  relayDirectorUrl: hivecodeProductConfig.services.relay.enabled
    ? hivecodeProductConfig.services.relay.directorUrl
    : null,
  relayEnabled: hivecodeProductConfig.services.relay.enabled,
  scope: 'openid profile email offline_access hive.session.exchange',
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
