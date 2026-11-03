import { compareAppVersions, isValidAppVersion } from './app-version'
import { resolveProductUpdateSource } from './product-update-source'

export type ReleaseChannel = 'internal' | 'stable' | 'beta' | 'rc' | 'hourly' | 'daily' | 'adhoc'

// Why: hourly/daily/adhoc are retained as historical version kinds, but their upstream
// workflows publish to repositories that the product manifest does not
// configure. They must remain unavailable until dedicated product sources exist.
export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ['internal', 'stable', 'beta', 'rc']

export const RELEASE_CHANNEL_LABELS: Readonly<Record<ReleaseChannel, string>> = {
  internal: 'Internal',
  stable: 'Stable',
  beta: 'Beta',
  rc: 'RC',
  hourly: 'Hourly',
  daily: 'Daily',
  adhoc: 'Adhoc'
}

export const HOURLY_PRERELEASE_IDENTIFIER = 'hourly'
export const DAILY_PRERELEASE_IDENTIFIER = 'daily'
export const ADHOC_PRERELEASE_IDENTIFIER = 'adhoc'

/** Historical dev channels whose upstream workflows publish outside the main repo. */
const DEDICATED_REPO_CHANNELS = ['hourly', 'daily', 'adhoc'] as const

export type DedicatedRepoChannel = (typeof DEDICATED_REPO_CHANNELS)[number]
export function isReleaseChannel(value: unknown): value is ReleaseChannel {
  return typeof value === 'string' && RELEASE_CHANNELS.includes(value as ReleaseChannel)
}

/** Historical source classification only; this does not mean the channel is configured. */
export function hasDedicatedReleaseRepo(channel: ReleaseChannel): channel is DedicatedRepoChannel {
  return (DEDICATED_REPO_CHANNELS as readonly ReleaseChannel[]).includes(channel)
}

/**
 * The platforms each dev channel actually builds for. Split from
 * `hasDedicatedReleaseRepo` because "published to its own repo" and "built for
 * this OS" stopped coinciding once the dev workflows gained a Windows job —
 * Linux has no dev-channel artifact yet, so it still falls back to stable/RC.
 */
const DEV_CHANNEL_PLATFORMS: Readonly<Record<DedicatedRepoChannel, readonly NodeJS.Platform[]>> = {
  hourly: ['darwin', 'win32'],
  daily: ['darwin', 'win32'],
  adhoc: ['darwin', 'win32']
}

/** Human-readable list of where dev builds exist, for picker copy that would
 *  otherwise have to restate the table above and drift from it. */
export const DEV_CHANNEL_PLATFORM_LABEL = 'macOS and Windows'

/**
 * Shared so the picker, the main-process check, and any future surface cannot
 * drift on where a channel is available.
 *
 * The platform parameter remains part of the boundary for future product
 * manifests. Today every configured channel is cross-platform, while unconfigured
 * dev channels fail closed before platform-specific logic can make them visible.
 */
export function isChannelSupportedOnPlatform(
  channel: ReleaseChannel,
  platform: NodeJS.Platform
): boolean {
  if (!isReleaseChannel(channel)) {
    return false
  }
  if (!hasDedicatedReleaseRepo(channel)) {
    return true
  }
  return DEV_CHANNEL_PLATFORMS[channel].includes(platform)
}

/**
 * True when the running build cannot reach `targetChannel` through the in-app
 * updater and the installer has to be run by hand instead.
 *
 * Windows dev builds ship unsigned, because SignPath's approval waits are
 * budgeted in hours and cannot fit an hourly cadence. electron-updater
 * Authenticode-verifies every installer it downloads against the publisherName
 * baked into the *installed* app's app-update.yml, so a signed stable or RC
 * rejects an unsigned dev installer outright with ERR_UPDATER_INVALID_SIGNATURE
 * — and no change to a future build can fix the copies already installed.
 *
 * Dev builds omit that name, so verification is skipped there and every route
 * *out* of a dev channel, including back to stable, still works in-app. Only
 * the way in is blocked, and only on Windows.
 *
 * A null `runningChannel` (an unparseable version) is treated as signed: the
 * conservative answer sends someone to a working download rather than to an
 * update that fails with a signature error.
 */
export function requiresManualDevChannelInstall(options: {
  platform: NodeJS.Platform
  runningChannel: ReleaseChannel | null
  targetChannel: ReleaseChannel
}): boolean {
  const { platform, runningChannel, targetChannel } = options
  if (
    !isReleaseChannel(targetChannel) ||
    platform !== 'win32' ||
    !hasDedicatedReleaseRepo(targetChannel)
  ) {
    return false
  }
  return runningChannel === null || !hasDedicatedReleaseRepo(runningChannel)
}

export function getReleaseRepoForChannel(channel: ReleaseChannel): string | null {
  if (!isReleaseChannel(channel)) {
    return null
  }
  return resolveProductUpdateSource()?.github?.repo ?? null
}

export function normalizeTagToVersion(tag: string): string {
  return tag.replace(/^v/i, '')
}

/** Timestamp versions prevent electron-updater treating successive builds as identical (1.4.160-hourly.202607281400). */
const HOURLY_VERSION = /^\d+\.\d+\.\d+-hourly\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/

/** Minute-stamped daily versions also permit unique forced recuts later the same day. */
const DAILY_VERSION = /^\d+\.\d+\.\d+-daily\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/

/** Use second-resolution adhoc stamps: concurrent branch dispatches lack hourly/daily serialization and can collide within a minute. */
const ADHOC_VERSION = /^\d+\.\d+\.\d+-adhoc\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/

/** Anchor the whole version so garbage prefixes cannot parse as valid build stamps. */
function parseStampedVersion(version: string, pattern: RegExp): Date | null {
  const match = normalizeTagToVersion(version).match(pattern)
  if (!match) {
    return null
  }
  const [year, month, day, hour, minute, second = 0] = match.slice(1).map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  // Round-trip components because Date.UTC normalizes impossible dates (February 30→March 2).
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    return null
  }
  return parsed
}

export function isHourlyVersion(version: string): boolean {
  return HOURLY_VERSION.test(normalizeTagToVersion(version))
}

export function isDailyVersion(version: string): boolean {
  return DAILY_VERSION.test(normalizeTagToVersion(version))
}

export function isAdhocVersion(version: string): boolean {
  return ADHOC_VERSION.test(normalizeTagToVersion(version))
}

export function parseHourlyVersionStamp(version: string): Date | null {
  return parseStampedVersion(version, HOURLY_VERSION)
}

export function parseDailyVersionStamp(version: string): Date | null {
  return parseStampedVersion(version, DAILY_VERSION)
}

export function parseAdhocVersionStamp(version: string): Date | null {
  return parseStampedVersion(version, ADHOC_VERSION)
}

/** Read any dev build timestamp so picker rows need no per-channel branching. */
export function parseDevBuildStamp(version: string): Date | null {
  return (
    parseHourlyVersionStamp(version) ??
    parseDailyVersionStamp(version) ??
    parseAdhocVersionStamp(version)
  )
}

export function getVersionChannel(version: string): ReleaseChannel | null {
  const normalized = normalizeTagToVersion(version)
  if (!isValidAppVersion(normalized)) {
    return null
  }
  if (isHourlyVersion(normalized)) {
    return 'hourly'
  }
  if (isDailyVersion(normalized)) {
    return 'daily'
  }
  if (isAdhocVersion(normalized)) {
    return 'adhoc'
  }
  // Why the dev channels are tested first: they are prereleases too, so this
  // catch-all would otherwise file every one of them under rc.
  if (normalized.includes('-beta.')) {
    return 'beta'
  }
  if (normalized.includes('-internal.')) {
    return 'internal'
  }
  return normalized.includes('-') ? 'rc' : 'stable'
}

/** Dev tags need their publishing repo or links 404. Missing versions use the releases list; latest can fail during GitHub API degradation. */
export function getReleaseNotesUrlForVersion(version: string | null): string | null {
  const channel = version ? getVersionChannel(version) : null
  const repo = getReleaseRepoForChannel(channel ?? 'stable')
  if (!repo) {
    return null
  }
  return version
    ? `https://github.com/${repo}/releases/tag/v${normalizeTagToVersion(version)}`
    : `https://github.com/${repo}/releases`
}

/** Require each platform’s updater manifest: missing/in-progress platform legs must not offer picker entries whose downloads 404. */
const PLATFORM_UPDATE_MANIFESTS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: ['latest-mac.yml'],
  win32: ['latest.yml'],
  // Both, because one release carries x64 and arm64 and either makes it installable.
  linux: ['latest-linux.yml', 'latest-linux-arm64.yml']
}

export function getUpdateManifestNamesForPlatform(platform: NodeJS.Platform): readonly string[] {
  return PLATFORM_UPDATE_MANIFESTS[platform] ?? []
}

/** True when the release carries an artifact this platform's updater can install. */
export function hasInstallableArtifactForPlatform(
  platform: NodeJS.Platform,
  assetNames: readonly string[]
): boolean {
  const manifests = getUpdateManifestNamesForPlatform(platform)
  // Unknown platforms should fail with a download explanation rather than an empty picker.
  if (manifests.length === 0) {
    return true
  }
  return manifests.some((manifest) => assetNames.includes(manifest))
}

/** Match electron-builder’s runnable installer names for manual bootstrap when in-app switching cannot work. */
const PLATFORM_INSTALLER_PATTERNS: Partial<Record<NodeJS.Platform, RegExp>> = {
  darwin: /\.dmg$/i,
  win32: /windows-setup\.exe$/i,
  linux: /\.AppImage$/i
}

export function findInstallerAssetName(
  platform: NodeJS.Platform,
  assetNames: readonly string[]
): string | null {
  const pattern = PLATFORM_INSTALLER_PATTERNS[platform]
  if (!pattern) {
    return null
  }
  return assetNames.find((name) => pattern.test(name)) ?? null
}

export type ReleaseBuild = {
  tag: string
  version: string
  channel: ReleaseChannel
  /** Null for missing/tag-repeated titles so the picker distinguishes workflow names from unnamed builds. */
  name: string | null
  publishedAt: string | null
  releaseUrl: string
  /** Platform installer, null when unpublished; signed Windows builds use this to bootstrap unsigned dev channels. */
  installerUrl: string | null
}

/** Newest first, so the picker's first row is always the channel's current tip. */
export function sortReleaseBuildsNewestFirst(builds: ReleaseBuild[]): ReleaseBuild[] {
  return [...builds].sort((left, right) => {
    // Branches can predate current main’s base version; use dev build time rather than semver for picker recency.
    const leftStamp = parseDevBuildStamp(left.version)?.getTime() ?? null
    const rightStamp = parseDevBuildStamp(right.version)?.getTime() ?? null
    if (leftStamp !== null && rightStamp !== null && leftStamp !== rightStamp) {
      return rightStamp - leftStamp
    }

    if (hasDedicatedReleaseRepo(left.channel) && hasDedicatedReleaseRepo(right.channel)) {
      const leftPublished = left.publishedAt ? Date.parse(left.publishedAt) : Number.NaN
      const rightPublished = right.publishedAt ? Date.parse(right.publishedAt) : Number.NaN
      if (
        Number.isFinite(leftPublished) &&
        Number.isFinite(rightPublished) &&
        leftPublished !== rightPublished
      ) {
        return rightPublished - leftPublished
      }
    }

    return compareAppVersions(right.version, left.version)
  })
}
