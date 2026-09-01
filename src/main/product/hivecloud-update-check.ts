import { compareProductVersions, isProductVersion } from '../../shared/product-version'
import { validateHiveCloudArtifactForRequest } from './hivecloud-update-artifact-validation'
import { readHiveCloudUpdateJson } from './hivecloud-update-response'

const HIVECLOUD_UPDATE_CHECK_PATH = '/hive/v1/updates/check'
const MAX_UPDATE_VERSION_LENGTH = 64
const MAX_UPDATE_IDENTITY_LENGTH = 64
const MAX_UPDATE_URL_LENGTH = 2048
const MAX_UPDATE_BLOCK_REASON_LENGTH = 256
const MAX_UPDATE_RELEASE_NOTES_LENGTH = 64 * 1024

export type HiveCloudUpdateArtifact = {
  packageFormat: string
  architecture: string
  distributionType: string
  downloadUrl: string | null
  storeUrl: string | null
  sha256: string | null
  sha512: string | null
  size: number | null
}

export type HiveCloudUpdateDecision = {
  hasUpdate: boolean
  updateRequired: boolean
  blockReason: string | null
  currentBuild: number
  minimumSupportedBuild: number | null
  artifact: HiveCloudUpdateArtifact | null
  latest: {
    versionName: string
    buildNumber: number
    releaseNotes: string
    mandatory: boolean
    publishedAt: string
    artifact: HiveCloudUpdateArtifact | null
  } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown, maxLength = MAX_UPDATE_IDENTITY_LENGTH): string | null {
  return typeof value === 'string' && value.length <= maxLength ? value : null
}

function artifactsEqual(
  left: HiveCloudUpdateArtifact | null,
  right: HiveCloudUpdateArtifact | null
): boolean {
  if (left === null || right === null) {
    return left === right
  }
  return (
    left.packageFormat === right.packageFormat &&
    left.architecture === right.architecture &&
    left.distributionType === right.distributionType &&
    left.downloadUrl === right.downloadUrl &&
    left.storeUrl === right.storeUrl &&
    left.sha256 === right.sha256 &&
    left.sha512 === right.sha512 &&
    left.size === right.size
  )
}

function optionalPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function parseArtifact(value: unknown): HiveCloudUpdateArtifact | null | undefined {
  if (value === null) {
    return null
  }
  if (!isRecord(value)) {
    return undefined
  }
  const packageFormat = optionalString(value.packageFormat)
  const architecture = optionalString(value.architecture)
  const distributionType =
    optionalString(value.distributionType) ?? optionalString(value.distribution)
  const size = value.size === null ? null : optionalPositiveInteger(value.size)
  if (
    !packageFormat ||
    !architecture ||
    !distributionType ||
    (value.size !== null && size === null)
  ) {
    return undefined
  }
  return {
    packageFormat,
    architecture,
    distributionType,
    downloadUrl: optionalString(value.downloadUrl, MAX_UPDATE_URL_LENGTH),
    storeUrl: optionalString(value.storeUrl, MAX_UPDATE_URL_LENGTH),
    sha256: optionalString(value.sha256, 128),
    sha512: optionalString(value.sha512, 128),
    size
  }
}

export function parseHiveCloudUpdateDecision(value: unknown): HiveCloudUpdateDecision | null {
  if (!isRecord(value)) {
    return null
  }
  const currentBuild = optionalPositiveInteger(value.currentBuild)
  if (
    typeof value.hasUpdate !== 'boolean' ||
    typeof value.updateRequired !== 'boolean' ||
    !currentBuild
  ) {
    return null
  }
  const minimumSupportedBuild =
    value.minimumSupportedBuild === null
      ? null
      : optionalPositiveInteger(value.minimumSupportedBuild)
  if (value.minimumSupportedBuild !== null && minimumSupportedBuild === null) {
    return null
  }

  let latest: HiveCloudUpdateDecision['latest'] = null
  let artifact: HiveCloudUpdateArtifact | null = null
  let latestArtifactPresent = false
  if (value.latest !== null) {
    if (!isRecord(value.latest)) {
      return null
    }
    const buildNumber = optionalPositiveInteger(value.latest.buildNumber)
    const versionName = optionalString(value.latest.versionName, MAX_UPDATE_VERSION_LENGTH)
    const releaseNotes =
      optionalString(value.latest.releaseNotes, MAX_UPDATE_RELEASE_NOTES_LENGTH) ??
      optionalString(value.latest.notes, MAX_UPDATE_RELEASE_NOTES_LENGTH)
    const publishedAt = optionalString(value.latest.publishedAt, 128)
    if (
      !buildNumber ||
      !versionName ||
      !isProductVersion(versionName) ||
      releaseNotes === null ||
      releaseNotes.length > MAX_UPDATE_RELEASE_NOTES_LENGTH ||
      !publishedAt ||
      (Object.hasOwn(value.latest, 'mandatory') && typeof value.latest.mandatory !== 'boolean')
    ) {
      return null
    }
    latestArtifactPresent = Object.hasOwn(value.latest, 'artifact')
    const nestedArtifact = latestArtifactPresent ? parseArtifact(value.latest.artifact) : null
    if (nestedArtifact === undefined) {
      return null
    }
    artifact = nestedArtifact
    latest = {
      versionName,
      buildNumber,
      releaseNotes,
      mandatory: value.latest.mandatory === true,
      publishedAt,
      artifact
    }
  }
  if (Object.hasOwn(value, 'artifact')) {
    const topLevelArtifact = parseArtifact(value.artifact)
    if (topLevelArtifact === undefined) {
      return null
    }
    if (
      latest &&
      latestArtifactPresent &&
      latest.artifact !== null &&
      topLevelArtifact !== null &&
      !artifactsEqual(latest.artifact, topLevelArtifact)
    ) {
      return null
    }
    // A null legacy field is treated as an absent compatibility placeholder;
    // prefer whichever representation carries the immutable artifact.
    artifact = topLevelArtifact ?? latest?.artifact ?? null
    if (latest && !latest.artifact && topLevelArtifact) {
      latest = { ...latest, artifact: topLevelArtifact }
    }
  }
  if (value.updateRequired && (!value.hasUpdate || latest === null)) {
    return null
  }
  // A published release can remain marked mandatory after this client has
  // already moved past it.  `mandatory` describes the release, while
  // `hasUpdate` describes this request; do not turn a harmless latest-release
  // annotation into a client-side failure or an offline block.
  if (value.hasUpdate && latest === null) {
    return null
  }
  const blockReason =
    value.blockReason === null || value.blockReason === undefined
      ? null
      : optionalString(value.blockReason, MAX_UPDATE_BLOCK_REASON_LENGTH)
  if (value.blockReason !== null && value.blockReason !== undefined && blockReason === null) {
    return null
  }
  return {
    hasUpdate: value.hasUpdate,
    updateRequired: value.updateRequired,
    blockReason,
    currentBuild,
    minimumSupportedBuild,
    artifact,
    latest
  }
}

export async function fetchHiveCloudUpdateDecision(options: {
  endpoint: string
  product: string
  platform: string
  architecture: string
  channel: string
  currentVersion: string
  currentBuild: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<HiveCloudUpdateDecision> {
  if (
    !Number.isSafeInteger(options.currentBuild) ||
    options.currentBuild < 1 ||
    typeof options.product !== 'string' ||
    options.product.length < 1 ||
    options.product.length > MAX_UPDATE_IDENTITY_LENGTH ||
    !options.product.trim() ||
    typeof options.platform !== 'string' ||
    options.platform.length < 1 ||
    options.platform.length > MAX_UPDATE_IDENTITY_LENGTH ||
    !options.platform.trim() ||
    typeof options.architecture !== 'string' ||
    options.architecture.length < 1 ||
    options.architecture.length > MAX_UPDATE_IDENTITY_LENGTH ||
    !options.architecture.trim() ||
    typeof options.channel !== 'string' ||
    options.channel.length < 1 ||
    options.channel.length > MAX_UPDATE_IDENTITY_LENGTH ||
    !['internal', 'beta', 'stable', 'rc'].includes(options.channel.toLowerCase()) ||
    typeof options.currentVersion !== 'string' ||
    options.currentVersion.length < 1 ||
    options.currentVersion.length > MAX_UPDATE_VERSION_LENGTH ||
    !isProductVersion(options.currentVersion)
  ) {
    throw new Error('HiveCloud update request contains invalid identity fields')
  }
  if (typeof options.endpoint !== 'string' || options.endpoint.length > MAX_UPDATE_URL_LENGTH) {
    throw new Error('HiveCloud update endpoint is invalid')
  }
  const url = new URL(options.endpoint)
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname.includes('%') ||
    url.pathname !== HIVECLOUD_UPDATE_CHECK_PATH
  ) {
    throw new Error('HiveCloud update endpoint must use the canonical HTTPS check path')
  }
  url.search = new URLSearchParams({
    product: options.product,
    platform: options.platform,
    architecture: options.architecture,
    channel: options.channel,
    currentVersion: options.currentVersion,
    currentBuild: String(options.currentBuild)
  }).toString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000)
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`HiveCloud update check failed (${response.status})`)
    }
    const body = await readHiveCloudUpdateJson(response)
    const decision = parseHiveCloudUpdateDecision(body)
    if (!decision) {
      throw new Error('HiveCloud update check returned an invalid response')
    }
    if (decision.currentBuild !== options.currentBuild) {
      throw new Error('HiveCloud update response does not match the requested build')
    }
    if (decision.hasUpdate && decision.latest && !decision.latest.artifact && !decision.artifact) {
      throw new Error('HiveCloud update response is missing the update artifact')
    }
    for (const artifact of [decision.artifact, decision.latest?.artifact]) {
      if (artifact) {
        validateHiveCloudArtifactForRequest(artifact, options, url.origin)
      }
    }
    const versionOrder = decision.latest
      ? compareProductVersions(decision.latest.versionName, options.currentVersion)
      : null
    const latestIsNewer =
      decision.latest !== null &&
      (versionOrder! > 0 ||
        (versionOrder === 0 && decision.latest.buildNumber > options.currentBuild))
    if (decision.latest?.mandatory && !decision.hasUpdate && latestIsNewer) {
      throw new Error('HiveCloud update response hides a mandatory newer release')
    }
    if (
      decision.latest &&
      decision.hasUpdate &&
      (decision.latest.buildNumber <= options.currentBuild || versionOrder! < 0)
    ) {
      throw new Error('HiveCloud update response contains a stale build')
    }
    return decision
  } finally {
    clearTimeout(timeout)
  }
}
