import { hivecodeProductConfig } from '../generated/product-config'
import { isProductVersion } from '../../../src/shared/product-version'

export const MAX_UPDATE_RESPONSE_BYTES = 256 * 1024
export const UPDATE_REQUEST_TIMEOUT_MS = 5000
const MAX_ANDROID_UPDATE_BYTES = 512 * 1024 * 1024
export const MAX_UPDATE_VERSION_LENGTH = 64
export const MAX_UPDATE_URL_LENGTH = 2048
const MAX_UPDATE_RELEASE_NOTES_LENGTH = 64 * 1024
export const HIVECLOUD_UPDATE_CHECK_PATH = '/hive/v1/updates/check'
const HIVECLOUD_ARTIFACT_PATH_PATTERN =
  /^\/hive\/v1\/update-artifacts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/download$/i
const APP_STORE_URL_PATTERN = /^\/(?:[a-z]{2}\/)?app\/[^/]+\/id[0-9]+\/?$/i
const TESTFLIGHT_URL_PATTERN = /^\/join\/[A-Za-z0-9]{6,32}\/?$/
export const MOBILE_UPDATE_CHANNELS = new Set(['internal', 'beta', 'stable', 'rc'])

export type MobileUpdateArtifact = {
  packageFormat: string
  distributionType: string
  downloadUrl: string | null
  storeUrl: string | null
  sha256: string | null
  size: number | null
}

export function assertMobileUpdateArtifact(
  artifact: MobileUpdateArtifact | null,
  platform: 'android' | 'ios',
  allowedDownloadOrigin: string | null = null,
  expectedChannel: string | null = hivecodeProductConfig.services.update.channel
): MobileUpdateArtifact {
  if (platform === 'ios') {
    let storeHost = ''
    let storePort = ''
    try {
      const url = new URL(artifact?.storeUrl ?? '')
      if (url.protocol === 'https:') {
        storeHost = url.hostname.toLowerCase()
        storePort = url.port
      }
    } catch {
      // The common validation below reports the user-facing contract error.
    }
    if (
      !artifact ||
      typeof artifact.packageFormat !== 'string' ||
      typeof artifact.distributionType !== 'string' ||
      typeof artifact.storeUrl !== 'string' ||
      artifact.storeUrl.length > MAX_UPDATE_URL_LENGTH ||
      artifact.packageFormat.toLowerCase() !== 'store_link' ||
      !['apps.apple.com', 'testflight.apple.com'].includes(storeHost) ||
      storePort !== '' ||
      artifact.downloadUrl !== null ||
      artifact.sha256 !== null ||
      artifact.size !== null
    ) {
      throw new Error('HiveCloud returned an invalid iOS store link')
    }
    const storeUrl = new URL(artifact.storeUrl)
    if (storeUrl.username !== '' || storeUrl.password !== '') {
      throw new Error('HiveCloud returned an invalid iOS store link')
    }
    const validPath =
      (storeHost === 'apps.apple.com' && APP_STORE_URL_PATTERN.test(storeUrl.pathname)) ||
      (storeHost === 'testflight.apple.com' && TESTFLIGHT_URL_PATTERN.test(storeUrl.pathname))
    const distribution = artifact.distributionType.toLowerCase()
    const storeMatchesDistribution =
      (storeHost === 'apps.apple.com' && distribution === 'app_store') ||
      (storeHost === 'testflight.apple.com' && distribution === 'testflight')
    const channel = expectedChannel?.trim().toLowerCase() ?? ''
    const storeMatchesChannel =
      channel === 'internal' ||
      (channel === 'stable' && distribution === 'app_store') ||
      ((channel === 'beta' || channel === 'rc') && distribution === 'testflight')
    if (
      !MOBILE_UPDATE_CHANNELS.has(channel) ||
      !validPath ||
      !storeMatchesDistribution ||
      !storeMatchesChannel ||
      storeUrl.search !== '' ||
      storeUrl.hash !== ''
    ) {
      throw new Error('HiveCloud returned an invalid iOS store link')
    }
    return artifact
  }
  if (
    !artifact ||
    typeof artifact.packageFormat !== 'string' ||
    typeof artifact.distributionType !== 'string' ||
    artifact.packageFormat.toLowerCase() !== 'apk' ||
    artifact.distributionType.toLowerCase() !== 'direct' ||
    typeof artifact.downloadUrl !== 'string' ||
    artifact.downloadUrl.length > MAX_UPDATE_URL_LENGTH ||
    !/^https:\/\//i.test(artifact.downloadUrl) ||
    typeof artifact.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(artifact.sha256) ||
    typeof artifact.size !== 'number' ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 1 ||
    artifact.size > MAX_ANDROID_UPDATE_BYTES ||
    artifact.storeUrl !== null
  ) {
    throw new Error('HiveCloud returned an invalid Android update artifact')
  }
  let downloadUrl: URL
  try {
    downloadUrl = new URL(artifact.downloadUrl)
  } catch {
    throw new Error('HiveCloud returned an invalid Android update URL')
  }
  if (
    downloadUrl.protocol !== 'https:' ||
    (allowedDownloadOrigin !== null && downloadUrl.origin !== allowedDownloadOrigin) ||
    downloadUrl.username !== '' ||
    downloadUrl.password !== '' ||
    downloadUrl.search !== '' ||
    downloadUrl.hash !== '' ||
    !HIVECLOUD_ARTIFACT_PATH_PATTERN.test(downloadUrl.pathname)
  ) {
    throw new Error('HiveCloud returned an Android URL outside the object-storage gateway')
  }
  return artifact
}

function mobileArtifactIdentity(value: unknown): string | null | undefined {
  if (value === null) {
    return null
  }
  if (value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const candidate = value as Record<string, unknown>
  const distributionType =
    typeof candidate.distributionType === 'string'
      ? candidate.distributionType
      : typeof candidate.distribution === 'string'
        ? candidate.distribution
        : null
  return JSON.stringify({
    packageFormat: typeof candidate.packageFormat === 'string' ? candidate.packageFormat : null,
    distributionType,
    downloadUrl: typeof candidate.downloadUrl === 'string' ? candidate.downloadUrl : null,
    storeUrl: typeof candidate.storeUrl === 'string' ? candidate.storeUrl : null,
    sha256: typeof candidate.sha256 === 'string' ? candidate.sha256 : null,
    size: typeof candidate.size === 'number' ? candidate.size : null
  })
}

export function parseMobileUpdateDecision(value: unknown): {
  hasUpdate: boolean
  updateRequired: boolean
  currentBuild: number | null
  latest: {
    versionName: string
    buildNumber: number
    releaseNotes: string
    mandatory: boolean
    artifact: MobileUpdateArtifact | null
  } | null
  minimumSupportedBuild: number | null
} {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid update response')
  }
  const response = value as Record<string, unknown>
  const latest = response.latest as Record<string, unknown> | null
  if (typeof response.hasUpdate !== 'boolean' || typeof response.updateRequired !== 'boolean') {
    throw new Error('Invalid update response')
  }
  if (response.updateRequired && (!response.hasUpdate || response.latest === null)) {
    throw new Error('Invalid mandatory update response')
  }
  if (response.hasUpdate && response.latest === null) {
    throw new Error('Invalid update response')
  }
  const minimumSupportedBuild =
    response.minimumSupportedBuild === null
      ? null
      : typeof response.minimumSupportedBuild === 'number' &&
          Number.isSafeInteger(response.minimumSupportedBuild) &&
          response.minimumSupportedBuild > 0
        ? response.minimumSupportedBuild
        : null
  if (response.minimumSupportedBuild !== null && minimumSupportedBuild === null) {
    throw new Error('Invalid minimum supported build')
  }
  const responseCurrentBuild =
    typeof response.currentBuild === 'number' &&
    Number.isSafeInteger(response.currentBuild) &&
    response.currentBuild > 0
      ? response.currentBuild
      : null
  if (responseCurrentBuild === null) {
    throw new Error('Invalid current build')
  }
  if (latest === null) {
    return {
      hasUpdate: response.hasUpdate,
      updateRequired: response.updateRequired,
      currentBuild: responseCurrentBuild,
      latest: null,
      minimumSupportedBuild
    }
  }
  if (
    !latest ||
    typeof latest.versionName !== 'string' ||
    !isProductVersion(latest.versionName) ||
    typeof latest.buildNumber !== 'number' ||
    !Number.isSafeInteger(latest.buildNumber) ||
    latest.buildNumber < 1 ||
    latest.versionName.length > MAX_UPDATE_VERSION_LENGTH
  ) {
    throw new Error('Invalid latest update response')
  }
  if (Object.hasOwn(latest, 'mandatory') && typeof latest.mandatory !== 'boolean') {
    throw new Error('Invalid latest update response')
  }
  // The latest release may be marked mandatory even when this client is
  // already newer. `hasUpdate` is request-relative; keep the release flag
  // for newer clients without treating it as a malformed response.
  const latestArtifactPresent = Object.hasOwn(latest, 'artifact')
  const topLevelArtifactPresent = Object.hasOwn(response, 'artifact')
  const latestArtifactValue = latestArtifactPresent ? latest.artifact : undefined
  const topLevelArtifactValue = topLevelArtifactPresent ? response.artifact : undefined
  const latestArtifactIdentity = latestArtifactPresent
    ? mobileArtifactIdentity(latestArtifactValue)
    : null
  const topLevelArtifactIdentity = topLevelArtifactPresent
    ? mobileArtifactIdentity(topLevelArtifactValue)
    : null
  if (
    (latestArtifactPresent && latestArtifactIdentity === undefined) ||
    (topLevelArtifactPresent && topLevelArtifactIdentity === undefined)
  ) {
    throw new Error('Invalid update artifact')
  }
  if (
    latestArtifactPresent &&
    topLevelArtifactPresent &&
    latestArtifactIdentity !== null &&
    topLevelArtifactIdentity !== null &&
    latestArtifactIdentity !== topLevelArtifactIdentity
  ) {
    throw new Error('Conflicting update artifacts')
  }
  // A null legacy field is treated as an absent compatibility placeholder;
  // prefer whichever representation carries the immutable artifact.
  const selectedArtifactValue =
    topLevelArtifactValue !== undefined && topLevelArtifactValue !== null
      ? topLevelArtifactValue
      : latestArtifactValue
  const artifact =
    selectedArtifactValue !== null && selectedArtifactValue !== undefined
      ? (() => {
          if (typeof selectedArtifactValue !== 'object' || Array.isArray(selectedArtifactValue)) {
            throw new Error('Invalid update artifact')
          }
          const candidate = selectedArtifactValue as Record<string, unknown>
          const distributionType =
            typeof candidate.distributionType === 'string'
              ? candidate.distributionType
              : candidate.distribution
          return {
            ...candidate,
            distributionType
          } as MobileUpdateArtifact
        })()
      : null
  const releaseNotesValue =
    typeof latest.releaseNotes === 'string'
      ? latest.releaseNotes
      : typeof latest.notes === 'string'
        ? latest.notes
        : ''
  if (releaseNotesValue.length > MAX_UPDATE_RELEASE_NOTES_LENGTH) {
    throw new Error('Invalid latest update response')
  }
  return {
    hasUpdate: response.hasUpdate,
    updateRequired: response.updateRequired,
    currentBuild: responseCurrentBuild,
    latest: {
      versionName: latest.versionName,
      buildNumber: latest.buildNumber,
      releaseNotes: releaseNotesValue,
      mandatory: latest.mandatory === true,
      artifact
    },
    minimumSupportedBuild
  }
}
