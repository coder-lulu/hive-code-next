import { translate } from '../i18n/mobile-i18n'
import { AppState, Linking, Platform } from 'react-native'
import {
  subscribeApkDownloadProgress,
  downloadVerifiedApk,
  openApkInstaller,
  requestApkInstallPermission
} from '@hivecode/expo-hivecode-updater'
import { hivecodeProductConfig } from '../generated/product-config'
import { assertMobileUpdateArtifact } from './mobile-update-contract'
import { updateEndpointOrigin } from './mobile-update-endpoint'
import { configuredUpdateChannel } from './mobile-update-cache'
import {
  snapshot,
  publish,
  updateOperations,
  type MobileUpdateSnapshot
} from './mobile-update-state'

let downloadedApk: { sha256: string; contentUri: string } | null = null
export function downloadAndInstallAndroidUpdate(): Promise<MobileUpdateSnapshot> {
  if (updateOperations.install) {
    return updateOperations.install
  }
  updateOperations.install = Promise.resolve()
    .then(async () => {
      if (updateOperations.check) {
        await updateOperations.check
      }
      return installUpdate()
    })
    .finally(() => {
      updateOperations.install = null
    })
  return updateOperations.install
}

async function installUpdate(): Promise<MobileUpdateSnapshot> {
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
        message: translate(
          'auto.mobile.src.update.mobile.update.install.9079e7f6cd',
          'Opened App Store/TestFlight.'
        )
      })
    } catch (error) {
      return publish({
        ...snapshot,
        state: 'error',
        message: error instanceof Error ? error.message : '商店更新链接不可用'
      })
    }
  }
  const target = snapshot
  let unsubscribe = () => {}
  try {
    const allowedOrigin = updateEndpointOrigin()
    if (!allowedOrigin) {
      throw new Error('HiveCloud update endpoint is not configured')
    }
    const artifact = assertMobileUpdateArtifact(target.artifact, 'android', allowedOrigin)
    if (!(await requestApkInstallPermission())) {
      return publish({
        ...target,
        state: 'awaiting-permission',
        promptVisible: true,
        message: translate(
          'auto.mobile.src.update.mobile.update.install.e5f134866a',
          'Allow HiveCode to install unknown apps. The update will continue automatically when you return.'
        )
      })
    }
    if (downloadedApk?.sha256 !== artifact.sha256) {
      downloadedApk = null
    }
    if (!downloadedApk) {
      publish({
        ...target,
        state: 'downloading',
        promptVisible: true,
        message: null,
        downloadedBytes: 0,
        totalBytes: artifact.size!
      })
      unsubscribe = subscribeApkDownloadProgress((progress) => {
        if (
          progress.sha256 !== artifact.sha256 ||
          snapshot.state !== 'downloading' ||
          !Number.isFinite(progress.downloadedBytes)
        ) {
          return
        }
        publish({
          ...snapshot,
          downloadedBytes: Math.max(
            snapshot.downloadedBytes,
            Math.min(artifact.size!, Math.max(0, progress.downloadedBytes))
          )
        })
      })
      const contentUri = await downloadVerifiedApk({
        downloadUrl: artifact.downloadUrl!,
        allowedOrigin,
        allowedCdnOrigin: hivecodeProductConfig.services.update.artifactCdnOrigin,
        expectedSize: artifact.size!,
        expectedSha256: artifact.sha256!
      })
      if (!contentUri.startsWith('content://')) {
        throw new Error('系统安装器不可用')
      }
      downloadedApk = { sha256: artifact.sha256!, contentUri }
    }
    if (!snapshot.promptVisible || AppState.currentState !== 'active') {
      return publish({
        ...snapshot,
        state: 'ready-to-install',
        // Re-open the prompt after a background download completes. The
        // foreground observer will show it when Android resumes the app.
        promptVisible: true,
        downloadedBytes: artifact.size!,
        message: translate(
          'auto.mobile.src.update.mobile.update.install.d9e66f793d',
          'Download complete. Open the installer to finish updating.'
        )
      })
    }
    publish({
      ...snapshot,
      state: 'opening-installer',
      downloadedBytes: artifact.size!,
      message: null
    })
    try {
      await openApkInstaller(downloadedApk.contentUri)
    } catch (error) {
      downloadedApk = null
      throw error
    }
    return publish({
      ...snapshot,
      state: 'ready-to-install',
      message: translate(
        'auto.mobile.src.update.mobile.update.install.c49f8392f7',
        'Handed off to the system installer.'
      )
    })
  } catch (error) {
    return publish({
      ...snapshot,
      state: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    unsubscribe()
  }
}
