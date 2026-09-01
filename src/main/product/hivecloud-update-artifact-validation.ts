import { isBoundedUpdaterArtifactSize } from '../updater-artifact-size-policy'

export type HiveCloudArtifactForValidation = {
  packageFormat: string
  architecture: string
  distributionType: string
  downloadUrl: string | null
  storeUrl: string | null
  sha256: string | null
  sha512: string | null
  size: number | null
}

const HIVECLOUD_ARTIFACT_PATH_PATTERN =
  /^\/hive\/v1\/(?:internal-)?update-artifacts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/download$/i
const STORE_LINK_HOSTS = new Set(['apps.apple.com', 'testflight.apple.com'])
const APP_STORE_PATH_PATTERN = /^\/(?:[a-z]{2}\/)?app\/[^/]+\/id[0-9]+\/?$/i
const TESTFLIGHT_PATH_PATTERN = /^\/join\/[A-Za-z0-9]{6,32}\/?$/
const UPDATE_CHANNELS = new Set(['internal', 'beta', 'stable', 'rc'])
const DESKTOP_FORMATS: Record<string, string> = {
  windows: 'nsis',
  macos: 'zip',
  linux: 'appimage'
}

function validateStoreLink(
  artifact: HiveCloudArtifactForValidation,
  distribution: string,
  channel: string
): void {
  if (!artifact.storeUrl) {
    throw new Error('HiveCloud update response contains an invalid store link')
  }
  let url: URL
  try {
    url = new URL(artifact.storeUrl)
  } catch {
    throw new Error('HiveCloud update response contains an invalid store link')
  }
  const host = url.hostname.toLowerCase()
  const validPath =
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    STORE_LINK_HOSTS.has(host) &&
    url.search === '' &&
    url.hash === '' &&
    ((host === 'apps.apple.com' && APP_STORE_PATH_PATTERN.test(url.pathname)) ||
      (host === 'testflight.apple.com' && TESTFLIGHT_PATH_PATTERN.test(url.pathname)))
  const storeMatchesDistribution =
    (host === 'apps.apple.com' && distribution === 'app_store') ||
    (host === 'testflight.apple.com' && distribution === 'testflight')
  const storeMatchesChannel =
    channel === 'internal' ||
    (channel === 'stable' && distribution === 'app_store') ||
    ((channel === 'beta' || channel === 'rc') && distribution === 'testflight')
  if (
    !validPath ||
    !storeMatchesDistribution ||
    !storeMatchesChannel ||
    artifact.downloadUrl !== null ||
    artifact.sha256 !== null ||
    artifact.sha512 !== null ||
    artifact.size !== null
  ) {
    throw new Error('HiveCloud update response contains an invalid store link')
  }
}

export function validateHiveCloudArtifactForRequest(
  artifact: HiveCloudArtifactForValidation,
  options: { platform: string; architecture: string; channel: string },
  origin: string
): void {
  const platform = options.platform.toLowerCase()
  const channel = options.channel.toLowerCase()
  const packageFormat = artifact.packageFormat.toLowerCase()
  const distribution = artifact.distributionType.toLowerCase()
  if (packageFormat === 'store_link') {
    if (
      platform !== 'ios' ||
      !UPDATE_CHANNELS.has(channel) ||
      !['app_store', 'testflight'].includes(distribution)
    ) {
      throw new Error('HiveCloud update response contains an invalid store artifact')
    }
    validateStoreLink(artifact, distribution, channel)
    return
  }
  if (platform === 'ios') {
    throw new Error('HiveCloud iOS updates must use a store link')
  }
  const expectedFormat = DESKTOP_FORMATS[platform] ?? (platform === 'android' ? 'apk' : null)
  if (!expectedFormat || packageFormat !== expectedFormat) {
    throw new Error('HiveCloud update response contains an invalid package format')
  }
  const architecture = options.architecture.toLowerCase()
  const artifactArchitecture = artifact.architecture.toLowerCase()
  if (
    artifactArchitecture !== architecture &&
    artifactArchitecture !== 'universal' &&
    artifactArchitecture !== 'any'
  ) {
    throw new Error('HiveCloud update response contains an incompatible architecture')
  }
  if (
    distribution !== 'direct' &&
    !(platform !== 'android' && channel === 'internal' && distribution === 'internal')
  ) {
    throw new Error('HiveCloud update response contains an invalid distribution')
  }
  if (
    !artifact.downloadUrl ||
    !artifact.sha256 ||
    !/^[a-f0-9]{64}$/i.test(artifact.sha256) ||
    !artifact.sha512 ||
    !/^[a-f0-9]{128}$/i.test(artifact.sha512) ||
    artifact.size === null ||
    !isBoundedUpdaterArtifactSize(artifact.size) ||
    artifact.storeUrl !== null
  ) {
    throw new Error('HiveCloud update response contains an incomplete artifact')
  }
  let artifactUrl: URL
  try {
    artifactUrl = new URL(artifact.downloadUrl)
  } catch {
    throw new Error('HiveCloud update response contains an invalid artifact URL')
  }
  if (
    artifactUrl.protocol !== 'https:' ||
    artifactUrl.origin !== origin ||
    artifactUrl.username !== '' ||
    artifactUrl.password !== '' ||
    artifactUrl.search !== '' ||
    artifactUrl.hash !== '' ||
    !HIVECLOUD_ARTIFACT_PATH_PATTERN.test(artifactUrl.pathname) ||
    !artifactUrl.pathname.startsWith(
      channel === 'internal' ? '/hive/v1/internal-update-artifacts/' : '/hive/v1/update-artifacts/'
    )
  ) {
    throw new Error('HiveCloud update response points outside the object-storage gateway')
  }
}
