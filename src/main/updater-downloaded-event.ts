import { preExtractDownloadedAppImageUpdate } from './cli/appimage-copy-pre-extraction'
import { app } from 'electron'
import type { UpdaterHandlerContext } from './updater-events-context'
import {
  captureMacDownloadGenerationForNativeReady,
  isMacInstallerReady
} from './updater-mac-install'
import { compareVersions } from './updater-fallback'
import { recordUpdaterLifecycle } from './updater-lifecycle-diagnostics'
import { clearTrackedLinuxPackageArtifact } from './linux-package-update-recovery'
import * as linuxPackageRecovery from './linux-package-update-recovery'
import {
  resolveLinuxPackageDownloadedStatus,
  shouldIgnoreDownloadedUpdateEvent
} from './linux-package-downloaded-status'

export function registerDownloadedUpdateHandler({
  autoUpdater,
  getCurrentStatus,
  getPendingInstallVersion,
  clearBackgroundCheckLaunchPending,
  acceptDownloadedUpdateCandidate,
  sendErrorStatus,
  isLocalBuildCheck,
  isPinnedBuildCheck,
  restoreReleaseUpdateSource,
  clearAvailableUpdateContext,
  sendStatus,
  isMacStagingDeferredToInstall,
  startMacStaging,
  getUpdateMetadata,
  getKnownReleaseUrl
}: UpdaterHandlerContext): void {
  autoUpdater.on('update-downloaded', (info) => {
    // Why: an earlier download can finish after a newer target replaced it; uncached pre-staged events have no target to compare.
    if (
      shouldIgnoreDownloadedUpdateEvent(
        getCurrentStatus(),
        info.version,
        getPendingInstallVersion()
      )
    ) {
      return
    }
    clearBackgroundCheckLaunchPending()
    if (!acceptDownloadedUpdateCandidate(info.version)) {
      clearTrackedLinuxPackageArtifact()
      sendErrorStatus('Downloaded update did not match the verified candidate.', true)
      if (isLocalBuildCheck() || isPinnedBuildCheck()) {
        restoreReleaseUpdateSource()
      }
      return
    }
    // Release downloads remain newer-only; the local source was validated before checking, and a pinned jump is explicit.
    if (
      !isLocalBuildCheck() &&
      !isPinnedBuildCheck() &&
      compareVersions(info.version, app.getVersion()) <= 0
    ) {
      clearAvailableUpdateContext()
      linuxPackageRecovery.clearTrackedLinuxPackageArtifact()
      sendStatus({ state: 'not-available' })
      return
    }
    // Why: retain the verified artifact now — the 'error' event after a failed install no longer carries it.
    if (process.platform === 'darwin') {
      // Why: bind the current download generation so the late native-ready signal
      // from Squirrel.Mac can verify it still belongs to this download cycle.
      captureMacDownloadGenerationForNativeReady()
    }
    const macInstallerReady = process.platform === 'darwin' ? isMacInstallerReady() : true
    recordUpdaterLifecycle('update_downloaded', { version: info.version, macInstallerReady })
    void preExtractDownloadedAppImageUpdate(info.downloadedFile, (filePath) =>
      linuxPackageRecovery.isInUpdaterPendingCache(filePath)
    )
    const linuxPackageStatus = resolveLinuxPackageDownloadedStatus(info)
    if (linuxPackageStatus) {
      sendStatus({ ...linuxPackageStatus, ...getUpdateMetadata() })
      return
    }
    // On macOS, defer 'downloaded' until Squirrel.Mac finishes processing; other platforms are ready immediately.
    if (process.platform === 'darwin' && !macInstallerReady && !isMacStagingDeferredToInstall()) {
      // Keep the UI at 100% downloaded while Squirrel processes, to avoid a premature "ready to install".
      recordUpdaterLifecycle('macos_waiting_for_squirrel', { version: info.version })
      sendStatus({
        state: 'downloading',
        percent: 100,
        version: info.version,
        ...getUpdateMetadata()
      })
      startMacStaging()
      return
    }
    sendStatus({
      state: 'downloaded',
      version: info.version,
      releaseUrl: getKnownReleaseUrl(),
      ...getUpdateMetadata()
    })
  })
}
