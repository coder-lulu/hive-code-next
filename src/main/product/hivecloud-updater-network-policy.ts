import { hivecodeProductConfig } from '../../shared/generated/product-config'
import { isHiveCloudArtifactCdnUrl } from '../../shared/hivecloud-artifact-cdn'

export const HIVECLOUD_UPDATE_CHECK_PATH = '/hive/v1/updates/check'
const HIVECLOUD_UPDATE_FEED_PREFIX = '/hive/v1/updates/desktop/'
const HIVECLOUD_UPDATE_FEED_PATH_PATTERN =
  /^\/hive\/v1\/updates\/desktop\/(?:internal|beta|stable|rc)\/(?:windows|macos|linux)\/(?:x64|arm64)\/$/
const HIVECLOUD_UPDATE_MANIFEST_NAMES = new Set([
  'latest.yml',
  'latest-mac.yml',
  'latest-linux.yml',
  'latest-linux-arm64.yml'
])
const HIVECLOUD_ARTIFACT_PATH_PATTERN =
  /^\/hive\/v1\/(?:internal-)?update-artifacts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/download$/i
const NO_CACHE_VALUE_PATTERN = /^[0-9a-v]+$/

function isCanonicalHiveCloudReleaseFeed(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    !url.pathname.includes('%') &&
    HIVECLOUD_UPDATE_FEED_PATH_PATTERN.test(url.pathname)
  )
}

function isAllowedHiveCloudArtifactPath(url: URL, feed: URL): boolean {
  if (!HIVECLOUD_ARTIFACT_PATH_PATTERN.test(url.pathname)) {
    return false
  }
  const channel = feed.pathname.match(
    /^\/hive\/v1\/updates\/desktop\/(internal|beta|stable|rc)\//
  )?.[1]
  const expectedPrefix =
    channel === 'internal' ? '/hive/v1/internal-update-artifacts/' : '/hive/v1/update-artifacts/'
  return url.pathname.startsWith(expectedPrefix)
}

export function hasAllowedUpdaterCacheQuery(url: URL): boolean {
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

export function isAllowedHiveCloudReleaseFeedRequest(
  url: URL,
  releaseFeedUrl: string | null
): boolean {
  let feed: URL
  try {
    feed = new URL(releaseFeedUrl ?? '')
  } catch {
    return false
  }
  if (
    feed.protocol !== 'https:' ||
    feed.username ||
    feed.password ||
    feed.search ||
    feed.hash ||
    !feed.pathname.endsWith('/') ||
    feed.pathname.includes('%')
  ) {
    return false
  }
  const isSameFeedOrigin =
    url.origin === feed.origin &&
    url.pathname.startsWith(feed.pathname) &&
    !url.pathname.includes('%')
  if (feed.pathname.startsWith(HIVECLOUD_UPDATE_FEED_PREFIX) && isSameFeedOrigin) {
    if (!isCanonicalHiveCloudReleaseFeed(feed)) {
      return false
    }
    // The feed is metadata-only. Installer bytes must use the UUID-scoped
    // object-storage gateway below.
    const relativePath = url.pathname.slice(feed.pathname.length)
    return HIVECLOUD_UPDATE_MANIFEST_NAMES.has(relativePath) && hasAllowedUpdaterCacheQuery(url)
  }
  return isSameFeedOrigin && hasAllowedUpdaterCacheQuery(url)
}

/**
 * HiveCloud release bytes are served through an immutable UUID gateway backed
 * by private OSS. The configured feed remains metadata-only.
 */
export function isAllowedHiveCloudArtifactRequest(
  url: URL,
  releaseFeedUrl: string | null
): boolean {
  let feed: URL
  try {
    feed = new URL(releaseFeedUrl ?? '')
  } catch {
    return false
  }
  return (
    feed.protocol === 'https:' &&
    !feed.username &&
    !feed.password &&
    !feed.search &&
    !feed.hash &&
    isCanonicalHiveCloudReleaseFeed(feed) &&
    url.protocol === 'https:' &&
    url.origin === feed.origin &&
    !url.search &&
    !url.hash &&
    !url.pathname.includes('%') &&
    isAllowedHiveCloudArtifactPath(url, feed)
  )
}

export function isHiveCloudReleaseFeed(releaseFeedUrl: string | null): boolean {
  try {
    const feed = new URL(releaseFeedUrl ?? '')
    return (
      feed.protocol === 'https:' &&
      !feed.username &&
      !feed.password &&
      !feed.search &&
      !feed.hash &&
      !feed.pathname.includes('%') &&
      // Any path claiming this namespace is authoritative. A malformed feed
      // must fail closed instead of falling back to GitHub.
      feed.pathname.startsWith(HIVECLOUD_UPDATE_FEED_PREFIX)
    )
  } catch {
    return false
  }
}
export function isAllowedHiveCloudArtifactCdnRequest(url: URL): boolean {
  return isHiveCloudArtifactCdnUrl(
    url.href,
    hivecodeProductConfig.services.update.artifactCdnOrigin
  )
}
