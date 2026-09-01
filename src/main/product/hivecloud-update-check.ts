import { compareProductVersions, isProductVersion } from '../../shared/product-version'
import { validateHiveCloudArtifactForRequest } from './hivecloud-update-artifact-validation'
import { readHiveCloudUpdateJson } from './hivecloud-update-response'
import {
  MAX_UPDATE_IDENTITY_LENGTH,
  MAX_UPDATE_URL_LENGTH,
  MAX_UPDATE_VERSION_LENGTH,
  parseHiveCloudUpdateDecision,
  type HiveCloudUpdateDecision
} from './hivecloud-update-decision'

export { parseHiveCloudUpdateDecision } from './hivecloud-update-decision'
export type { HiveCloudUpdateArtifact, HiveCloudUpdateDecision } from './hivecloud-update-decision'

const HIVECLOUD_UPDATE_CHECK_PATH = '/hive/v1/updates/check'

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
