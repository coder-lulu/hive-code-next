/* eslint-disable max-lines */
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { Linking, Platform } from 'react-native'
import {
  deleteDownloadedApk,
  downloadVerifiedApk,
  openApkInstaller,
  requestApkInstallPermission
} from '@hivecode/expo-hivecode-updater'
import { hivecodeProductConfig } from '../generated/product-config'
import { compareProductVersions, isProductVersion } from '../../../src/shared/product-version'

const LAST_CHECK_KEY = 'hivecode:update:last-check:v1'
const CACHED_DECISION_KEY = 'hivecode:update:decision:v1'
const CHECK_INTERVAL_MS = hivecodeProductConfig.services.update.checkIntervalHours * 60 * 60 * 1000
const MAX_UPDATE_RESPONSE_BYTES = 256 * 1024
const UPDATE_REQUEST_TIMEOUT_MS = 5000
const MAX_ANDROID_UPDATE_BYTES = 512 * 1024 * 1024
const MAX_UPDATE_VERSION_LENGTH = 64
const MAX_UPDATE_URL_LENGTH = 2048
const MAX_UPDATE_RELEASE_NOTES_LENGTH = 64 * 1024
const HIVECLOUD_UPDATE_CHECK_PATH = '/hive/v1/updates/check'
const HIVECLOUD_ARTIFACT_PATH_PATTERN =
  /^\/hive\/v1\/update-artifacts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/download$/i
const APP_STORE_URL_PATTERN = /^\/(?:[a-z]{2}\/)?app\/[^/]+\/id[0-9]+\/?$/i
const TESTFLIGHT_URL_PATTERN = /^\/join\/[A-Za-z0-9]{6,32}\/?$/
const MOBILE_UPDATE_CHANNELS = new Set(['internal', 'beta', 'stable', 'rc'])

export type MobileUpdateArtifact = {
  packageFormat: string
  distributionType: string
  downloadUrl: string | null
  storeUrl: string | null
  sha256: string | null
  size: number | null
}

export type MobileUpdateSnapshot = {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready-to-install'
    | 'not-available'
    | 'error'
  version: string | null
  buildNumber: number | null
  mandatory: boolean
  minimumSupportedBuild: number | null
  message: string | null
  artifact: MobileUpdateArtifact | null
}

const INITIAL_SNAPSHOT: MobileUpdateSnapshot = {
  state: 'idle',
  version: null,
  buildNumber: null,
  mandatory: false,
  minimumSupportedBuild: null,
  message: null,
  artifact: null
}

let snapshot = INITIAL_SNAPSHOT
const listeners = new Set<() => void>()
let checkInFlight: Promise<MobileUpdateSnapshot> | null = null

function publish(next: MobileUpdateSnapshot): MobileUpdateSnapshot {
  snapshot = next
  listeners.forEach((listener) => listener())
  return next
}

export function getMobileUpdateSnapshot(): MobileUpdateSnapshot {
  return snapshot
}

export function subscribeMobileUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function normalizeAndroidArchitecture(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll('-', '_')
  switch (normalized) {
    case 'arm64':
    case 'arm64v8a':
    case 'arm64_v8a':
      return 'arm64_v8a'
    case 'armeabi':
    case 'armeabi7a':
    case 'armeabi_v7a':
    case 'armv7':
      return 'armeabi_v7a'
    case 'x8664':
    case 'x86_64':
      return 'x86_64'
    default:
      return normalized
  }
}

function resolveAndroidArchitecture(): string {
  if (Platform.OS !== 'android') {
    return 'any'
  }
  const platformConstants = Platform.constants as { Architecture?: unknown }
  return typeof platformConstants.Architecture === 'string'
    ? normalizeAndroidArchitecture(platformConstants.Architecture)
    : 'arm64_v8a'
}

function currentBuildNumber(): number {
  if (Platform.OS === 'ios') {
    const value = Number.parseInt(String(Constants.expoConfig?.ios?.buildNumber ?? '1'), 10)
    return Number.isSafeInteger(value) && value > 0 ? value : 1
  }
  const value = Number(Constants.expoConfig?.android?.versionCode ?? 1)
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

function currentVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0'
}

function configuredUpdateChannel(): string {
  const channel = hivecodeProductConfig.services.update.channel?.trim().toLowerCase() ?? ''
  if (!MOBILE_UPDATE_CHANNELS.has(channel)) {
    throw new Error('HiveCloud update channel is not configured')
  }
  return channel
}

async function readCachedMandatorySnapshot(): Promise<MobileUpdateSnapshot | null> {
  try {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      return null
    }
    const raw = await AsyncStorage.getItem(CACHED_DECISION_KEY)
    if (!raw) {
      return null
    }
    const cached = JSON.parse(raw) as { decision?: unknown; checkedAt?: unknown }
    if (typeof cached.checkedAt !== 'number' || !Number.isFinite(cached.checkedAt)) {
      return null
    }
    // A cached mandatory decision is cleared by a successful policy refresh
    // or by installing a different build. Wall-clock expiry would let an
    // offline device bypass a known support floor after 24 hours.
    const decision = parseMobileUpdateDecision(cached.decision)
    if (
      !decision.hasUpdate ||
      !decision.latest ||
      (!decision.updateRequired && !decision.latest.mandatory)
    ) {
      return null
    }
    if (decision.currentBuild !== currentBuildNumber()) {
      return null
    }
    // A cached mandatory decision is a safety policy, not an availability
    // hint.  Only discard it as stale when the locally reported product
    // version is itself valid; malformed legacy metadata must not turn a
    // previously enforced minimum into a fail-open path.
    const localVersion = currentVersion()
    if (isProductVersion(localVersion)) {
      const versionOrder = compareProductVersions(decision.latest.versionName, localVersion)
      if (
        versionOrder < 0 ||
        (versionOrder === 0 && decision.latest.buildNumber <= currentBuildNumber())
      ) {
        return null
      }
    }
    // Android downloads must stay on the configured HiveCloud origin. iOS
    // mandatory decisions are store links and do not need a download origin.
    const allowedOrigin = Platform.OS === 'android' ? updateEndpointOrigin() : null
    if (Platform.OS === 'android' && !allowedOrigin) {
      return null
    }
    const artifact = assertMobileUpdateArtifact(
      decision.latest.artifact,
      Platform.OS,
      allowedOrigin,
      configuredUpdateChannel()
    )
    return {
      state: 'error',
      version: decision.latest.versionName,
      buildNumber: decision.latest.buildNumber,
      mandatory: true,
      minimumSupportedBuild: decision.minimumSupportedBuild,
      message: '无法连接 HiveCloud，仍需安装已缓存的强制更新。',
      artifact
    }
  } catch {
    return null
  }
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

function updateEndpointOrigin(): string | null {
  try {
    const endpoint = hivecodeProductConfig.services.update.checkEndpoint ?? ''
    if (endpoint.length > MAX_UPDATE_URL_LENGTH) {
      return null
    }
    const url = new URL(endpoint)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.pathname.includes('%') ||
      url.pathname !== HIVECLOUD_UPDATE_CHECK_PATH
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
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

async function readJsonWithLimit(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel()
    throw new Error('更新检查响应过大')
  }
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error('更新检查响应过大')
    }
    return JSON.parse(text)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('更新检查响应过大')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export async function checkMobileUpdate(options?: {
  force?: boolean
  fetchImpl?: typeof fetch
}): Promise<MobileUpdateSnapshot> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return publish({
      ...INITIAL_SNAPSHOT,
      state: 'not-available',
      message: '商店更新将在 iOS 阶段接入。'
    })
  }
  if (checkInFlight) {
    return checkInFlight
  }
  const now = Date.now()
  if (!options?.force) {
    const lastCheck = Number.parseInt((await AsyncStorage.getItem(LAST_CHECK_KEY)) ?? '', 10)
    if (Number.isFinite(lastCheck) && now - lastCheck < CHECK_INTERVAL_MS) {
      // Restore a cached mandatory decision before honoring the throttle. This
      // keeps an app restart fail-closed when the last successful check already
      // required an update, even if HiveCloud is currently unreachable.
      const cachedMandatory = await readCachedMandatorySnapshot()
      if (cachedMandatory) {
        return publish(cachedMandatory)
      }
      return snapshot
    }
  }
  checkInFlight = (async () => {
    const previousSnapshot = snapshot
    publish({ ...snapshot, state: 'checking', message: null })
    try {
      const endpoint = hivecodeProductConfig.services.update.checkEndpoint
      if (!endpoint) {
        throw new Error('HiveCloud update check endpoint is not configured')
      }
      if (endpoint.length > MAX_UPDATE_URL_LENGTH) {
        throw new Error('HiveCloud update check endpoint is invalid')
      }
      const url = new URL(endpoint)
      if (
        url.protocol !== 'https:' ||
        url.username !== '' ||
        url.password !== '' ||
        url.search !== '' ||
        url.hash !== '' ||
        url.pathname.includes('%') ||
        url.pathname !== HIVECLOUD_UPDATE_CHECK_PATH
      ) {
        throw new Error('更新检查地址必须使用规范的 HTTPS 检查路径')
      }
      const channel = configuredUpdateChannel()
      const installedVersion = currentVersion()
      if (
        installedVersion.length > MAX_UPDATE_VERSION_LENGTH ||
        !isProductVersion(installedVersion)
      ) {
        throw new Error('HiveCode product version is invalid')
      }
      url.search = new URLSearchParams({
        product: hivecodeProductConfig.slug,
        platform: Platform.OS,
        architecture: Platform.OS === 'android' ? resolveAndroidArchitecture() : 'arm64',
        channel,
        currentVersion: installedVersion,
        currentBuild: String(currentBuildNumber())
      }).toString()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), UPDATE_REQUEST_TIMEOUT_MS)
      try {
        const response = await (options?.fetchImpl ?? fetch)(url, {
          redirect: 'error',
          signal: controller.signal,
          headers: { accept: 'application/json' }
        })
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(`更新检查失败（${response.status}）`)
        }
        const decision = parseMobileUpdateDecision(
          await readJsonWithLimit(response, MAX_UPDATE_RESPONSE_BYTES)
        )
        const current = currentVersion()
        const currentBuild = currentBuildNumber()
        if (decision.currentBuild !== null && decision.currentBuild !== currentBuild) {
          throw new Error('更新响应与当前构建版本不匹配')
        }
        const versionOrder = decision.latest
          ? compareProductVersions(decision.latest.versionName, current)
          : null
        const latestIsNewer =
          decision.latest !== null &&
          (versionOrder! > 0 || (versionOrder === 0 && decision.latest.buildNumber > currentBuild))
        if (decision.latest?.mandatory && !decision.hasUpdate && latestIsNewer) {
          throw new Error('更新响应隐藏了较新的强制版本')
        }
        if (
          decision.hasUpdate &&
          decision.latest &&
          (versionOrder! < 0 || (versionOrder === 0 && decision.latest.buildNumber <= currentBuild))
        ) {
          throw new Error('更新响应包含过期版本')
        }
        if (
          !decision.hasUpdate ||
          !decision.latest ||
          versionOrder! < 0 ||
          (versionOrder === 0 && decision.latest.buildNumber <= currentBuild)
        ) {
          await AsyncStorage.setItem(
            CACHED_DECISION_KEY,
            JSON.stringify({ decision, checkedAt: now })
          )
          await AsyncStorage.setItem(LAST_CHECK_KEY, String(now))
          return publish({ ...INITIAL_SNAPSHOT, state: 'not-available' })
        }
        const artifact = assertMobileUpdateArtifact(
          decision.latest.artifact,
          Platform.OS,
          url.origin,
          channel
        )
        await AsyncStorage.setItem(
          CACHED_DECISION_KEY,
          JSON.stringify({ decision, checkedAt: now })
        )
        await AsyncStorage.setItem(LAST_CHECK_KEY, String(now))
        return publish({
          state: 'available',
          version: decision.latest.versionName,
          buildNumber: decision.latest.buildNumber,
          mandatory: decision.updateRequired || decision.latest.mandatory,
          minimumSupportedBuild: decision.minimumSupportedBuild,
          message: decision.latest.releaseNotes,
          artifact
        })
      } finally {
        // Keep the timeout alive while the response body is consumed. Clearing
        // it immediately after fetch() leaves a hanging body read unbounded.
        clearTimeout(timeout)
      }
    } catch (error) {
      const cachedMandatory = snapshot.mandatory ? null : await readCachedMandatorySnapshot()
      return publish({
        ...(cachedMandatory ?? previousSnapshot),
        state: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      checkInFlight = null
    }
  })()
  return checkInFlight
}

export async function downloadAndInstallAndroidUpdate(): Promise<MobileUpdateSnapshot> {
  if (Platform.OS === 'ios') {
    try {
      const artifact = assertMobileUpdateArtifact(
        snapshot.artifact,
        'ios',
        null,
        configuredUpdateChannel()
      )
      await Linking.openURL(artifact.storeUrl!)
      return publish({
        ...snapshot,
        state: 'ready-to-install',
        message: '已打开 App Store/TestFlight。'
      })
    } catch (error) {
      return publish({
        ...snapshot,
        state: 'error',
        message: error instanceof Error ? error.message : '商店更新链接不可用'
      })
    }
  }
  publish({ ...snapshot, state: 'downloading', message: null })
  let contentUri: string | null = null
  try {
    const allowedOrigin = updateEndpointOrigin()
    if (!allowedOrigin) {
      throw new Error('HiveCloud update endpoint is not configured')
    }
    const artifact = assertMobileUpdateArtifact(snapshot.artifact, 'android', allowedOrigin)
    if (!(await requestApkInstallPermission())) {
      throw new Error('请在系统设置中允许 HiveCode 安装未知应用，然后重试')
    }
    contentUri = await downloadVerifiedApk({
      downloadUrl: artifact.downloadUrl!,
      allowedOrigin,
      expectedSize: artifact.size!,
      expectedSha256: artifact.sha256!
    })
    if (!contentUri.startsWith('content://')) {
      throw new Error('系统安装器不可用')
    }
    await openApkInstaller(contentUri)
    return publish({ ...snapshot, state: 'ready-to-install', message: '已交给系统安装器。' })
  } catch (error) {
    if (contentUri) {
      try {
        await deleteDownloadedApk(contentUri)
      } catch {
        /* best effort cleanup */
      }
    }
    return publish({
      ...snapshot,
      state: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
