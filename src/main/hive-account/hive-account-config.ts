import { app } from 'electron'
import { hivecodeProductConfig } from '../../shared/generated/product-config'

export type HiveAccountConfig = {
  apiBaseUrl: string
  identityIssuer: string
  clientId: string
  scope: string
}

type HiveAccountConfigResult =
  | { configured: true; config: HiveAccountConfig }
  | { configured: false; setupMessage: string }

export const HIVE_ACCOUNT_CLIENT_ID = 'hivecode-desktop'
const SCOPE = 'openid profile email hive.session.exchange'

function isPackagedBuild(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    return false
  }
}

function cleanUrl(
  value: string | null | undefined,
  packaged: boolean,
  requireOrigin: boolean
): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  try {
    const url = new URL(trimmed)
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    if (url.protocol !== 'https:' && (packaged || !loopback || url.protocol !== 'http:')) {
      return null
    }
    if (url.username || url.password || url.search || url.hash) {
      return null
    }
    if (requireOrigin && url.pathname !== '/') {
      return null
    }
    return requireOrigin ? url.origin : url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function getHiveAccountConfig(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedBuild()
): HiveAccountConfigResult {
  // Why: packaged builds must be reproducible and cannot redirect credentials
  // through launch-time environment variables.
  const apiCandidate = packaged
    ? hivecodeProductConfig.endpoints.cloud
    : env.HIVECODE_ACCOUNT_API_URL || hivecodeProductConfig.endpoints.cloud
  const issuerCandidate = packaged
    ? hivecodeProductConfig.endpoints.identityIssuer
    : env.HIVECODE_ACCOUNT_IDENTITY_ISSUER || hivecodeProductConfig.endpoints.identityIssuer
  const apiBaseUrl = cleanUrl(apiCandidate, packaged, true)
  const identityIssuer = cleanUrl(issuerCandidate, packaged, false)
  if (!apiBaseUrl || !identityIssuer) {
    return {
      configured: false,
      setupMessage: 'HiveCloud sign-in is not configured for this build.'
    }
  }
  return {
    configured: true,
    config: { apiBaseUrl, identityIssuer, clientId: HIVE_ACCOUNT_CLIENT_ID, scope: SCOPE }
  }
}
