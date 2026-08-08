import { resolveProductUpdateSource } from '../shared/product-update-source'
import {
  getReleaseRepoForChannel,
  getVersionChannel,
  normalizeTagToVersion,
  sortReleaseBuildsNewestFirst,
  type ReleaseBuild,
  type ReleaseChannel
} from '../shared/release-channel'
import { cancelUnreadResponseBody } from './lib/unread-response-body'
import { isValidVersion } from './updater-fallback'
import { fetchWithProductUpdaterSession } from './product/product-updater-session'
import { readResponseTextWithLimit } from './updater-response-body'

const FETCH_TIMEOUT_MS = 8000
const MAX_LISTED_BUILDS = 100
const MAX_RELEASE_API_BYTES = 1024 * 1024

function getReleasesApiUrl(releasesApiUrl: string): string {
  return `${releasesApiUrl}?per_page=${MAX_LISTED_BUILDS}`
}

export function getReleaseDownloadUrlForRepo(repo: string, tag: string): string {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`
}

type GitHubReleaseEntry = {
  tag_name?: unknown
  name?: unknown
  draft?: unknown
  published_at?: unknown
}

function parseReleaseEntry(entry: GitHubReleaseEntry, repo: string): ReleaseBuild | null {
  if (typeof entry.tag_name !== 'string' || entry.draft === true) {
    return null
  }
  const tag = entry.tag_name
  const version = normalizeTagToVersion(tag)
  const channel = getVersionChannel(version)
  if (!isValidVersion(version) || !channel) {
    return null
  }
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
    releaseUrl: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`
  }
}

/**
 * Lists published releases for a channel so the dev picker can offer an exact
 * build — including older ones — to jump to.
 *
 * Why the REST API rather than the atom feed the routine update path uses: the
 * feed caps at the 10 newest entries, which cannot express "jump back to
 * yesterday's hourly". This runs only on explicit dev interaction, so its
 * unauthenticated rate limit never touches background checks.
 */
export async function listReleaseBuilds(channel: ReleaseChannel): Promise<ReleaseBuild[]> {
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
    if (res.status === 404) {
      throw new Error(`No releases repository found at ${repo}.`)
    }
    if (res.status === 403 || res.status === 429) {
      throw new Error('GitHub rate limit reached. Try again in a few minutes.')
    }
    throw new Error(`Could not list ${channel} builds (HTTP ${res.status}).`)
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
    .map((entry) => parseReleaseEntry(entry as GitHubReleaseEntry, repo))
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
