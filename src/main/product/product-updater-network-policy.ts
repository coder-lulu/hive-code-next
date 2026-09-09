import { isBoundedUpdaterArtifactSize } from '../updater-artifact-size-policy'
import {
  HIVECLOUD_UPDATE_CHECK_PATH,
  hasAllowedUpdaterCacheQuery,
  isAllowedHiveCloudArtifactRequest,
  isAllowedHiveCloudArtifactCdnRequest,
  isAllowedHiveCloudReleaseFeedRequest,
  isHiveCloudReleaseFeed
} from './hivecloud-updater-network-policy'

const APPROVED_GITHUB_ASSET_ORIGINS = new Set([
  'https://objects.githubusercontent.com',
  'https://release-assets.githubusercontent.com'
])
const HIVECLOUD_UPDATE_CHECK_QUERY_KEYS = new Set([
  'product',
  'platform',
  'architecture',
  'channel',
  'currentVersion',
  'currentBuild'
])

const GITHUB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]'])

export type ProductUpdaterNetworkMode = 'release' | 'local'

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
      if (
        parsedAllowedUrl.protocol !== 'https:' ||
        parsedAllowedUrl.username ||
        parsedAllowedUrl.password ||
        parsedAllowedUrl.hash ||
        parsedAllowedUrl.pathname.includes('%') ||
        url.pathname.includes('%')
      ) {
        return false
      }

      if (parsedAllowedUrl.origin !== url.origin || parsedAllowedUrl.pathname !== url.pathname) {
        return false
      }

      // The HiveCloud check appends a fixed six-field request contract. Keep
      // this allow-list narrow: arbitrary query keys would turn every
      // explicitly configured control endpoint into a credential/token sink.
      if (url.pathname === HIVECLOUD_UPDATE_CHECK_PATH && parsedAllowedUrl.search === '') {
        const entries = [...url.searchParams.entries()]
        return (
          entries.length === HIVECLOUD_UPDATE_CHECK_QUERY_KEYS.size &&
          entries.every(
            ([name, value]) =>
              HIVECLOUD_UPDATE_CHECK_QUERY_KEYS.has(name) && value.trim().length > 0
          ) &&
          new Set(entries.map(([name]) => name)).size === entries.length
        )
      }

      return parsedAllowedUrl.search === url.search
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
  additionalReleaseControlUrls: readonly string[] = [],
  releaseFeedUrl: string | null = null
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
      hasAllowedUpdaterCacheQuery(parsed)
    )
  }

  if (isAllowedExactControlRequest(parsed, additionalReleaseControlUrls)) {
    return true
  }

  if (isAllowedHiveCloudReleaseFeedRequest(parsed, releaseFeedUrl)) {
    return true
  }

  if (isAllowedHiveCloudArtifactRequest(parsed, releaseFeedUrl)) {
    return true
  }

  // A HiveCloud feed is authoritative for its artifact bytes. Do not let the
  // legacy GitHub provider fallback turn a malformed/redirected HiveCloud
  // response back into a GitHub download.
  if (isHiveCloudReleaseFeed(releaseFeedUrl)) {
    return false
  }

  if (!productRepository || !GITHUB_REPOSITORY_PATTERN.test(productRepository)) {
    return false
  }

  if (isAllowedGitHubControlRequest(parsed, productRepository)) {
    return true
  }

  if (
    parsed.origin !== 'https://github.com' ||
    !hasAllowedUpdaterCacheQuery(parsed) ||
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
  localFeedUrl: string | null = null,
  releaseFeedUrl: string | null = null
): boolean {
  if (
    isAllowedProductUpdaterRequest(url, productRepository, mode, localFeedUrl, [], releaseFeedUrl)
  ) {
    return true
  }
  if (isHiveCloudReleaseFeed(releaseFeedUrl)) {
    try {
      return mode === 'release' && isAllowedHiveCloudArtifactCdnRequest(new URL(url))
    } catch {
      return false
    }
  }
  if (
    mode !== 'release' ||
    !productRepository ||
    !GITHUB_REPOSITORY_PATTERN.test(productRepository)
  ) {
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
  localFeedUrl: string | null,
  releaseFeedUrl: string | null = null
): boolean {
  if (
    !isAllowedProductUpdaterRequest(url, productRepository, mode, localFeedUrl, [], releaseFeedUrl)
  ) {
    return false
  }
  const parsed = new URL(url)
  if (/\.(?:ya?ml)$/i.test(parsed.pathname)) {
    return false
  }
  if (mode === 'local') {
    return true
  }
  // HiveCloud's feed is metadata-only.  Installer bytes must come from the
  // immutable object-storage gateway; accepting an arbitrary same-origin path
  // here would let a tampered YAML turn the feed host into a download proxy.
  if (isHiveCloudReleaseFeed(releaseFeedUrl)) {
    return isAllowedHiveCloudArtifactRequest(parsed, releaseFeedUrl)
  }
  if (isAllowedHiveCloudReleaseFeedRequest(parsed, releaseFeedUrl)) {
    return true
  }
  if (isAllowedHiveCloudArtifactRequest(parsed, releaseFeedUrl)) {
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
  localFeedUrl: string | null,
  releaseFeedUrl: string | null = null
): boolean {
  if (
    !isAllowedProductUpdaterRedirectTarget(
      url,
      productRepository,
      mode,
      localFeedUrl,
      releaseFeedUrl
    )
  ) {
    return false
  }
  const parsed = new URL(url)
  if (/\.(?:ya?ml)$/i.test(parsed.pathname)) {
    return false
  }
  if (mode === 'local') {
    return true
  }
  if (isHiveCloudReleaseFeed(releaseFeedUrl)) {
    return (
      isAllowedHiveCloudArtifactRequest(parsed, releaseFeedUrl) ||
      isAllowedHiveCloudArtifactCdnRequest(parsed)
    )
  }
  if (isAllowedHiveCloudReleaseFeedRequest(parsed, releaseFeedUrl)) {
    return true
  }
  if (isAllowedHiveCloudArtifactRequest(parsed, releaseFeedUrl)) {
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
