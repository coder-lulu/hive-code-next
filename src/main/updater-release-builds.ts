import { resolveProductUpdateSource } from '../shared/product-update-source'
import {
  findInstallerAssetName,
  getReleaseRepoForChannel,
  getVersionChannel,
  hasInstallableArtifactForPlatform,
  normalizeTagToVersion,
  sortReleaseBuildsNewestFirst,
  type ReleaseBuild,
  type ReleaseChannel
} from '../shared/release-channel'
import { cancelUnreadResponseBody } from './lib/unread-response-body'
import { parseRelayRetryAfterMs } from '../shared/relay-retry-after-header'
import { isValidVersion } from './updater-fallback'
import { fetchWithProductUpdaterSession } from './product/product-updater-session'
import { readResponseTextWithLimit } from './updater-response-body'

const FETCH_TIMEOUT_MS = 8000
const MAX_LISTED_BUILDS = 100
const MAX_RELEASE_API_BYTES = 1024 * 1024
const RETRY_AFTER_MAX_MS = 60 * 60_000

function getReleasesApiUrl(releasesApiUrl: string): string {
  return `${releasesApiUrl}?per_page=${MAX_LISTED_BUILDS}`
}

/** GitHub answers a spent primary bucket with 403 + `x-ratelimit-remaining: 0`; secondary limits carry Retry-After. */
function isRateLimited(res: Response): boolean {
  return (
    res.status === 429 ||
    (res.status === 403 &&
      (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')))
  )
}

/**
 * Retry-After wins when GitHub sends it: it is the bounded wait the server actually
 * asked for, while `x-ratelimit-reset` describes the primary window and can be an hour
 * out — quoting that for a 90-second secondary throttle overstates the wait to the user.
 * Retry-After arrives as seconds or an HTTP date; the reset epoch is the fallback.
 */
export function rateLimitResetAtMs(headers: Headers, nowMs: number): number | null {
  const retryAfterMs = parseRelayRetryAfterMs(headers.get('retry-after'), RETRY_AFTER_MAX_MS, nowMs)
  if (retryAfterMs !== null) {
    return nowMs + retryAfterMs
  }
  const resetEpochSeconds = Number(headers.get('x-ratelimit-reset'))
  return resetEpochSeconds > 0 ? resetEpochSeconds * 1000 : null
}

export function describeRateLimitReset(resetAtMs: number | null, nowMs: number): string {
  if (resetAtMs === null) {
    return 'in a few minutes'
  }
  const minutes = Math.ceil((resetAtMs - nowMs) / 60_000)
  return minutes <= 1 ? 'in about a minute' : `in about ${minutes} minutes`
}

function releaseListError(res: Response, repo: string, channel: ReleaseChannel): Error {
  if (res.status === 404) {
    return new Error(`No releases repository found at ${repo}.`)
  }
  if (isRateLimited(res)) {
    const nowMs = Date.now()
    const retry = describeRateLimitReset(rateLimitResetAtMs(res.headers, nowMs), nowMs)
    return new Error(`GitHub rate limit reached. Try again ${retry}.`)
  }
  return new Error(`Could not list ${channel} builds (HTTP ${res.status}).`)
}

export function getReleaseDownloadUrlForRepo(repo: string, tag: string): string {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`
}

type GitHubReleaseEntry = {
  tag_name?: unknown
  name?: unknown
  draft?: unknown
  published_at?: unknown
  html_url?: unknown
  assets?: unknown
}

function readAssetNames(assets: unknown): string[] {
  if (!Array.isArray(assets)) {
    return []
  }
  return assets
    .map((asset) => (asset as { name?: unknown })?.name)
    .filter((name): name is string => typeof name === 'string')
}

function parseReleaseEntry(
  entry: GitHubReleaseEntry,
  repo: string,
  platform: NodeJS.Platform
): ReleaseBuild | null {
  if (typeof entry.tag_name !== 'string' || entry.draft === true) {
    return null
  }
  const tag = entry.tag_name
  const version = normalizeTagToVersion(tag)
  const channel = getVersionChannel(version)
  if (!isValidVersion(version) || !channel) {
    return null
  }
  // Why filter on assets rather than on a per-channel platform table: a release
  // is published as soon as one platform's leg finishes, and a leg can fail
  // outright. Asking what the release actually carries covers both without the
  // picker ever offering a row whose download 404s.
  const assetNames = readAssetNames(entry.assets)
  if (!hasInstallableArtifactForPlatform(platform, assetNames)) {
    return null
  }
  const installerAsset = findInstallerAssetName(platform, assetNames)
  // Why null when it merely repeats the tag: GitHub titles an untitled release
  // with its tag name, and hourlies predating the naming change were created that
  // way too. Neither says anything the version beside it does not.
  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  return {
    tag,
    version,
    channel,
    name: name && name !== tag ? name : null,
    publishedAt: typeof entry.published_at === 'string' ? entry.published_at : null,
    releaseUrl: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
    installerUrl: installerAsset
      ? `${getReleaseDownloadUrlForRepo(repo, tag)}/${encodeURIComponent(installerAsset)}`
      : null
  }
}

/**
 * Lists published releases for a channel so the dev picker can offer an exact
 * build — including older ones — to jump to.
 *
 * Why the REST API rather than the atom feed the routine update path uses: the
 * feed caps at the 10 newest entries, which cannot express "jump back to
 * yesterday's hourly". This runs only on explicit dev interaction, so it never
 * touches background checks. Requests use the product updater session and
 * its configured repository authority.
 */
export async function listReleaseBuilds(
  channel: ReleaseChannel,
  platform: NodeJS.Platform = process.platform
): Promise<ReleaseBuild[]> {
  const github = resolveProductUpdateSource()?.github
  const repo = getReleaseRepoForChannel(channel)
  if (!github || !repo || github.repo !== repo) {
    return []
  }
  const res = await fetchWithProductUpdaterSession(getReleasesApiUrl(github.releasesApiUrl), {
    headers: { Accept: 'application/vnd.github+json' },
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) {
    await cancelUnreadResponseBody(res)
    throw releaseListError(res, repo, channel)
  }
  const body = await readResponseTextWithLimit(res, MAX_RELEASE_API_BYTES)
  if (body === null) {
    throw new Error(`The ${channel} release list is too large.`)
  }
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error(`Could not read the ${channel} release list.`)
  }
  if (!Array.isArray(payload)) {
    throw new Error(`Could not read the ${channel} release list.`)
  }
  const builds = payload
    .map((entry) => parseReleaseEntry(entry as GitHubReleaseEntry, repo, platform))
    .filter((build): build is ReleaseBuild => build !== null)
    // Why: the main repo serves both stable and rc, so filter to the asked-for channel.
    .filter((build) => build.channel === channel)
  return sortReleaseBuildsNewestFirst(builds)
}

export type ResolvedTargetBuild = {
  tag: string
  version: string
  feedUrl: string
}

/** Resolves a tag the user picked into a pinned generic feed URL. */
export function resolveTargetBuild(channel: ReleaseChannel, tag: string): ResolvedTargetBuild {
  const version = normalizeTagToVersion(tag)
  if (!isValidVersion(version)) {
    throw new Error(`"${tag}" is not a valid release tag.`)
  }
  const targetChannel = getVersionChannel(version)
  if (targetChannel !== channel) {
    throw new Error(`"${tag}" does not belong to the ${channel} channel.`)
  }
  const github = resolveProductUpdateSource()?.github
  const repo = getReleaseRepoForChannel(channel)
  if (!github || !repo || github.repo !== repo) {
    throw new Error(`The ${channel} product release repository is not configured.`)
  }
  return {
    tag,
    version,
    feedUrl: `${github.releasesDownloadBase}/${encodeURIComponent(tag)}`
  }
}
