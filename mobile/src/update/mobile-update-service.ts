import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { hasApkInstallPermission } from '@hivecode/expo-hivecode-updater'
import { hivecodeProductConfig } from '../generated/product-config'
import { compareProductVersions, isProductVersion } from '../../../src/shared/product-version'
import {
  assertMobileUpdateArtifact,
  parseMobileUpdateDecision,
  MAX_UPDATE_RESPONSE_BYTES,
  UPDATE_REQUEST_TIMEOUT_MS,
  MAX_UPDATE_VERSION_LENGTH,
  MAX_UPDATE_URL_LENGTH,
  HIVECLOUD_UPDATE_CHECK_PATH
} from './mobile-update-contract'
import { readJsonWithLimit } from './mobile-update-endpoint'
import {
  LAST_CHECK_KEY,
  CACHED_DECISION_KEY,
  currentVersion,
  currentBuildNumber,
  configuredUpdateChannel,
  resolveAndroidArchitecture,
  readCachedUpdateSnapshot
} from './mobile-update-cache'
import {
  INITIAL_SNAPSHOT,
  snapshot,
  publish,
  updateOperations,
  type MobileUpdateSnapshot
} from './mobile-update-state'

import { downloadAndInstallAndroidUpdate } from './mobile-update-install'
export { downloadAndInstallAndroidUpdate } from './mobile-update-install'
export {
  getMobileUpdateSnapshot,
  subscribeMobileUpdate,
  dismissMobileUpdatePrompt,
  showMobileUpdatePrompt
} from './mobile-update-state'
export type { MobileUpdateSnapshot } from './mobile-update-state'
export { assertMobileUpdateArtifact, parseMobileUpdateDecision } from './mobile-update-contract'
export type { MobileUpdateArtifact } from './mobile-update-contract'
export { normalizeAndroidArchitecture } from './mobile-update-cache'
const CHECK_INTERVAL_MS = hivecodeProductConfig.services.update.checkIntervalHours * 60 * 60 * 1000
export async function checkMobileUpdate(options?: {
  force?: boolean
  fetchImpl?: typeof fetch
}): Promise<MobileUpdateSnapshot> {
  if (
    updateOperations.install ||
    (!options?.force &&
      (snapshot.state === 'awaiting-permission' || snapshot.state === 'ready-to-install'))
  ) {
    return snapshot
  }
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return publish({
      ...INITIAL_SNAPSHOT,
      state: 'not-available',
      message: '商店更新将在 iOS 阶段接入。'
    })
  }
  if (updateOperations.check) {
    return updateOperations.check
  }
  const now = Date.now()
  updateOperations.check = (async () => {
    const previousSnapshot = snapshot
    try {
      if (!options?.force) {
        const lastCheck = Number.parseInt((await AsyncStorage.getItem(LAST_CHECK_KEY)) ?? '', 10)
        if (Number.isFinite(lastCheck) && now - lastCheck < CHECK_INTERVAL_MS) {
          // A check timestamp must not erase a known update after restarting.
          const cached = snapshot.state === 'idle' ? await readCachedUpdateSnapshot() : null
          if (cached) {
            return publish(cached)
          }
          return snapshot
        }
      }
      if (snapshot.state === 'idle') {
        const cached = await readCachedUpdateSnapshot()
        if (cached) {
          publish(cached)
        }
      }
      publish({ ...snapshot, state: 'checking' })
      const endpoint = hivecodeProductConfig.services.update.checkEndpoint as string | null
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
          ...INITIAL_SNAPSHOT,
          state: 'available',
          version: decision.latest.versionName,
          buildNumber: decision.latest.buildNumber,
          mandatory: decision.updateRequired || decision.latest.mandatory,
          minimumSupportedBuild: decision.minimumSupportedBuild,
          message: decision.latest.releaseNotes,
          artifact,
          promptVisible: true,
          totalBytes: artifact.size ?? 0
        })
      } finally {
        // Keep the timeout alive while the response body is consumed. Clearing
        // it immediately after fetch() leaves a hanging body read unbounded.
        clearTimeout(timeout)
      }
    } catch (error) {
      const cached = await readCachedUpdateSnapshot()
      return publish({
        ...(snapshot.artifact ? snapshot : (cached ?? previousSnapshot)),
        state: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      updateOperations.check = null
    }
  })()
  return updateOperations.check
}

export async function resumeMobileUpdate(): Promise<MobileUpdateSnapshot> {
  if (updateOperations.install) {
    return snapshot
  }
  if (snapshot.state === 'awaiting-permission') {
    if (!snapshot.promptVisible && !snapshot.mandatory) {
      return snapshot
    }
    try {
      if (
        (await hasApkInstallPermission()) &&
        snapshot.state === 'awaiting-permission' &&
        (snapshot.promptVisible || snapshot.mandatory)
      ) {
        return downloadAndInstallAndroidUpdate()
      }
    } catch (error) {
      return publish({ ...snapshot, state: 'error', message: String(error) })
    }
    return snapshot
  }
  return checkMobileUpdate()
}
