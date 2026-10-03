import { app } from 'electron'

export type OrcaCloudAuthConfig = {
  apiBaseUrl: string
  authorizeEndpoint: string
  sessionEndpoint: string
  refreshEndpoint: string
  capabilitiesEndpoint: string
  profileEndpoint: string
  orgEndpoint: string
  logoutEndpoint: string
  clientId: string
  scope: string
}

const DEFAULT_SCOPE = 'openid profile email offline_access'

// Why: packaged main bundles never define NODE_ENV, so packaged-ness is the
// only reliable production signal for gating dev-only auth escape hatches.
function isPackagedOrcaBuild(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    return false
  }
}

function cleanUrl(value: string | undefined, allowLoopbackHttp: boolean): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = new URL(trimmed)
    const loopbackHost =
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '[::1]'
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      (parsed.protocol === 'http:' && !(loopbackHost && allowLoopbackHttp)) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function endpoint(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString()
}

export type ProductCloudDefaults = {
  /** Production API base URL when no ORCA_CLOUD_API_URL env override; null = cloud is unavailable. */
  apiBaseUrl: string | null
  /** Production OAuth client id when no ORCA_CLOUD_CLIENT_ID env override. */
  clientId: string | null
  /** Product OAuth scopes when no ORCA_CLOUD_AUTH_SCOPE env override. */
  scope: string
  /** Label used in setupMessage when cloud is unconfigured in this product. */
  productLabel: string
}

export function getOrcaCloudAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedOrcaBuild(),
  productDefaults: ProductCloudDefaults
): { configured: true; config: OrcaCloudAuthConfig } | { configured: false; setupMessage: string } {
  // Why: loopback HTTP endpoints are a local-development convenience only;
  // packaged builds must not accept plain-HTTP token endpoints via env vars.
  const allowLoopbackHttp = !packaged
  const configEnv = packaged ? {} : env
  const cleanEndpointUrl = (value: string | undefined): string | null =>
    cleanUrl(value, allowLoopbackHttp)
  const configuredApiBaseUrl =
    configEnv.HIVE_PRODUCT_API_BASE_URL?.trim() || configEnv.ORCA_CLOUD_API_URL?.trim()
  // Why: packaged releases cannot depend on launch-time environment injection;
  // each product must explicitly supply its own non-secret production defaults.
  const apiBaseUrl = configuredApiBaseUrl
    ? cleanEndpointUrl(configuredApiBaseUrl)
    : packaged
      ? productDefaults.apiBaseUrl
      : null
  const clientId =
    configEnv.HIVE_PRODUCT_DESKTOP_CLIENT_ID?.trim() ||
    configEnv.ORCA_CLOUD_CLIENT_ID?.trim() ||
    (packaged ? productDefaults.clientId : undefined)
  if (!apiBaseUrl || !clientId) {
    return {
      configured: false,
      setupMessage: `${productDefaults.productLabel} sign-in is not configured for this build.`
    }
  }

  const authBaseUrl = cleanEndpointUrl(configEnv.ORCA_CLOUD_AUTH_URL) ?? apiBaseUrl
  return {
    configured: true,
    config: {
      apiBaseUrl,
      authorizeEndpoint:
        cleanEndpointUrl(configEnv.ORCA_CLOUD_AUTHORIZE_URL) ??
        endpoint(authBaseUrl, '/v1/desktop/auth/authorize'),
      sessionEndpoint:
        cleanEndpointUrl(configEnv.ORCA_CLOUD_SESSION_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/session'),
      refreshEndpoint:
        cleanEndpointUrl(configEnv.ORCA_CLOUD_REFRESH_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/refresh'),
      capabilitiesEndpoint:
        cleanEndpointUrl(configEnv.ORCA_CLOUD_CAPABILITIES_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/capabilities'),
      profileEndpoint:
        cleanEndpointUrl(configEnv.ORCA_CLOUD_PROFILE_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/profile'),
      orgEndpoint:
        cleanEndpointUrl(configEnv.ORCA_CLOUD_ORG_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/org'),
      logoutEndpoint:
        cleanEndpointUrl(configEnv.ORCA_CLOUD_LOGOUT_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/logout'),
      clientId,
      scope: configEnv.ORCA_CLOUD_AUTH_SCOPE?.trim() || productDefaults.scope || DEFAULT_SCOPE
    }
  }
}

export function allowsPlaintextOrcaCloudSession(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedOrcaBuild()
): boolean {
  return (
    env.ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION === '1' && env.NODE_ENV !== 'production' && !packaged
  )
}

export function isOrcaCloudDevAuthEnabled(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedOrcaBuild()
): boolean {
  return env.ORCA_CLOUD_DEV_AUTH === '1' && env.NODE_ENV !== 'production' && !packaged
}
