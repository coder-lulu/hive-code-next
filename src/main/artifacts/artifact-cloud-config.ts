import { app } from 'electron'

function isPackaged(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    return false
  }
}

export function resolveArtifactCloudApiUrl(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): string {
  const candidate = override?.trim() || env.ORCA_ARTIFACTS_API_URL?.trim()
  if (!candidate) {
    throw new Error('Artifact API URL is not configured.')
  }
  const apiUrl = validateArtifactCloudApiUrl(candidate, packaged)
  const url = new URL(apiUrl)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  const firstParty = url.hostname === 'onorca.dev' || url.hostname.endsWith('.onorca.dev')
  if (!firstParty && !loopback) {
    throw new Error('Artifact API URLs must use an onorca.dev or loopback host.')
  }
  return apiUrl
}

export function validateArtifactCloudApiUrl(candidate: string, packaged = isPackaged()): string {
  const url = new URL(candidate)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !packaged)) {
    throw new Error('Artifact API URLs must use HTTPS; local development may use loopback HTTP.')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Artifact API URL must be an origin without credentials, paths, or parameters.')
  }
  return url.origin
}

export function allowsArtifactCloudAuthOverride(
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): boolean {
  return env.NODE_ENV !== 'production' && !packaged
}
