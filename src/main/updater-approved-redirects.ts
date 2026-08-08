import { fetchWithProductUpdaterSession } from './product/product-updater-session'

const MAX_RELEASE_ASSET_REDIRECTS = 3
const APPROVED_GITHUB_ASSET_HOSTS = new Set([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

function resolveApprovedGitHubAssetRedirect(location: string, currentUrl: string): string | null {
  try {
    const redirected = new URL(location, currentUrl)
    if (
      redirected.protocol !== 'https:' ||
      redirected.username.length > 0 ||
      redirected.password.length > 0 ||
      redirected.port.length > 0 ||
      redirected.hash.length > 0 ||
      !APPROVED_GITHUB_ASSET_HOSTS.has(redirected.hostname)
    ) {
      return null
    }
    return redirected.toString()
  } catch {
    return null
  }
}

export async function fetchReleaseResourceWithApprovedRedirects(
  url: string,
  init: RequestInit
): Promise<Response> {
  let currentUrl = url
  for (let hop = 0; hop <= MAX_RELEASE_ASSET_REDIRECTS; hop += 1) {
    const response = await fetchWithProductUpdaterSession(currentUrl, {
      ...init,
      redirect: 'manual'
    })
    if (!(response.status >= 300 && response.status < 400)) {
      return response
    }
    try {
      await response.body?.cancel()
    } catch {
      // Best effort: redirect cleanup failures must not reopen a response rejected by policy.
    }
    if (hop === MAX_RELEASE_ASSET_REDIRECTS) {
      throw new Error('Release resource redirect limit exceeded')
    }
    const location = response.headers.get('location')
    const redirected = location ? resolveApprovedGitHubAssetRedirect(location, currentUrl) : null
    if (!redirected) {
      throw new Error('Release resource redirect is outside approved GitHub origins')
    }
    currentUrl = redirected
  }
  throw new Error('Release resource redirect limit exceeded')
}
