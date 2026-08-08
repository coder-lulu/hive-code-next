import { isBoundedUpdaterArtifactSize } from '../updater-artifact-size-policy'

const APPROVED_GITHUB_ASSET_ORIGINS = new Set([
  'https://objects.githubusercontent.com',
  'https://release-assets.githubusercontent.com'
])

const GITHUB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]'])
const NO_CACHE_VALUE_PATTERN = /^[0-9a-v]+$/

export type ProductUpdaterNetworkMode = 'release' | 'local'

function hasAllowedGitHubReleaseQuery(url: URL): boolean {
  if (!url.search) {
    return true
  }
  const entries = [...url.searchParams.entries()]
  return (
    entries.length === 1 &&
    entries[0][0] === 'noCache' &&
    NO_CACHE_VALUE_PATTERN.test(entries[0][1])
  )
}

function isAllowedGitHubControlRequest(url: URL, productRepository: string): boolean {
  if (url.origin === 'https://github.com') {
    return url.pathname === `/${productRepository}/releases.atom` && url.search.length === 0
  }
  if (url.origin !== 'https://api.github.com') {
    return false
  }
  return (
    url.pathname === `/repos/${productRepository}/releases` &&
    url.searchParams.size === 1 &&
    url.searchParams.get('per_page') === '100'
  )
}

function isAllowedExactControlRequest(url: URL, allowedUrls: readonly string[]): boolean {
  return allowedUrls.some((allowedUrl) => {
    try {
      const parsedAllowedUrl = new URL(allowedUrl)
      return (
        parsedAllowedUrl.protocol === 'https:' &&
        !parsedAllowedUrl.username &&
        !parsedAllowedUrl.password &&
        !parsedAllowedUrl.hash &&
        parsedAllowedUrl.href === url.href
      )
    } catch {
      return false
    }
  })
}

export function isAllowedProductUpdaterRequest(
  url: string,
  productRepository: string | null,
  mode: ProductUpdaterNetworkMode,
  localFeedUrl: string | null = null,
  additionalReleaseControlUrls: readonly string[] = []
): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.username || parsed.password || parsed.hash) {
    return false
  }

  if (mode === 'local') {
    let feed: URL
    try {
      feed = new URL(localFeedUrl ?? '')
    } catch {
      return false
    }
    return (
      feed.protocol === 'http:' &&
      LOOPBACK_HOSTS.has(feed.hostname) &&
      !feed.username &&
      !feed.password &&
      !feed.search &&
      !feed.hash &&
      feed.pathname.endsWith('/') &&
      parsed.origin === feed.origin &&
      parsed.pathname.startsWith(feed.pathname) &&
      hasAllowedGitHubReleaseQuery(parsed)
    )
  }

  if (!productRepository || !GITHUB_REPOSITORY_PATTERN.test(productRepository)) {
    return false
  }

  if (isAllowedExactControlRequest(parsed, additionalReleaseControlUrls)) {
    return true
  }

  if (isAllowedGitHubControlRequest(parsed, productRepository)) {
    return true
  }

  if (
    parsed.origin !== 'https://github.com' ||
    !hasAllowedGitHubReleaseQuery(parsed) ||
    parsed.pathname.includes('%')
  ) {
    return false
  }

  const releaseRoot = `/${productRepository}/releases`
  return parsed.pathname === releaseRoot || parsed.pathname.startsWith(`${releaseRoot}/`)
}

export function isAllowedProductUpdaterRedirectTarget(
  url: string,
  productRepository: string | null,
  mode: ProductUpdaterNetworkMode,
  localFeedUrl: string | null = null
): boolean {
  if (isAllowedProductUpdaterRequest(url, productRepository, mode, localFeedUrl)) {
    return true
  }
  if (mode !== 'release') {
    return false
  }
  try {
    const parsed = new URL(url)
    return (
      APPROVED_GITHUB_ASSET_ORIGINS.has(parsed.origin) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    )
  } catch {
    return false
  }
}

export function isFinalUpdaterArtifactUrl(
  url: string,
  productRepository: string | null,
  mode: ProductUpdaterNetworkMode,
  localFeedUrl: string | null
): boolean {
  if (!isAllowedProductUpdaterRequest(url, productRepository, mode, localFeedUrl)) {
    return false
  }
  const parsed = new URL(url)
  if (/\.(?:ya?ml)$/i.test(parsed.pathname)) {
    return false
  }
  if (mode === 'local') {
    return true
  }
  return (
    APPROVED_GITHUB_ASSET_ORIGINS.has(parsed.origin) ||
    (parsed.origin === 'https://github.com' && parsed.pathname.includes('/releases/download/'))
  )
}

export function isFinalUpdaterRedirectArtifactUrl(
  url: string,
  productRepository: string | null,
  mode: ProductUpdaterNetworkMode,
  localFeedUrl: string | null
): boolean {
  if (!isAllowedProductUpdaterRedirectTarget(url, productRepository, mode, localFeedUrl)) {
    return false
  }
  const parsed = new URL(url)
  if (/\.(?:ya?ml)$/i.test(parsed.pathname)) {
    return false
  }
  if (mode === 'local') {
    return true
  }
  return (
    APPROVED_GITHUB_ASSET_ORIGINS.has(parsed.origin) ||
    (parsed.origin === 'https://github.com' && parsed.pathname.includes('/releases/download/'))
  )
}

export function getBoundedArtifactContentLength(
  responseHeaders: Record<string, string[]> | undefined
): number | null {
  const entry = Object.entries(responseHeaders ?? {}).find(
    ([name]) => name.toLowerCase() === 'content-length'
  )
  const raw = entry?.[1]?.[0]
  if (!raw || !/^\d+$/.test(raw)) {
    return null
  }
  const value = Number(raw)
  return isBoundedUpdaterArtifactSize(value) ? value : null
}
