import { updaterCodedMessage } from '../../shared/updater-failure-copy'
import { isExternallyManagedLinuxInstall } from '../linux-update-package-type'
import { recordUpdaterLifecycle } from '../updater-lifecycle-diagnostics'
import {
  beginMacUpdateDownload,
  deferMacQuitUntilInstallerReady,
  isMacInstallRequested,
  setMacInstallPreflightInProgress
} from '../updater-mac-install'
import { prepareThisProcessShipItStaging } from './shipit-leftover-recovery'
import { UpdaterRemoteStatus } from './updater-remote-status'
import { QUIT_AND_INSTALL_DELAY_MS } from './updater-state'

export abstract class UpdaterDownloadInstall extends UpdaterRemoteStatus {
  protected quitAndInstall(): boolean {
    if (
      this.localBuildSelectionInProgress ||
      this.pinnedBuildSelectionInProgress ||
      this.pendingQuitAndInstallTimer ||
      this.quitAndInstallInProgress ||
      isMacInstallRequested()
    ) {
      return false
    }
    if (!this.hasInstallablePendingUpdate()) {
      recordUpdaterLifecycle('quit_and_install_ignored', { reason: 'no-downloaded-update' })
      this.sendToMainWindow('updater:quitAndInstallAborted')
      return false
    }
    if (this.routeLinuxRootPackageToManualInstall()) {
      return false
    }
    if (this.deferHeadlessServeInstall('install', this.getPendingInstallVersion())) {
      return false
    }
    this.finishActiveUpdateCheckAttempt()
    this.clearBackgroundCheckLaunchPending()
    if (
      !this.isMacStagingDeferredToInstall() &&
      deferMacQuitUntilInstallerReady(
        this.currentStatus,
        this.hasInstallableDownloadedVersion(),
        this.getPendingInstallVersion.bind(this),
        this.sendStatus.bind(this)
      )
    ) {
      return true
    }
    if (process.platform === 'darwin') {
      setMacInstallPreflightInProgress(true)
    }
    this.pendingQuitAndInstallTimer = setTimeout(() => {
      void this.performQuitAndInstall()
    }, QUIT_AND_INSTALL_DELAY_MS)
    return true
  }

  protected downloadUpdate(): void {
    if (
      this.localBuildSelectionInProgress ||
      this.pinnedBuildSelectionInProgress ||
      this.downloadInFlight
    ) {
      return
    }
    const canStart =
      this.currentStatus.state === 'available' ||
      (this.currentStatus.state === 'error' &&
        this.availableUpdateCandidate !== null &&
        this.isUpdateCandidateCurrent(this.availableUpdateCandidate))
    if (!canStart) {
      return
    }
    const version =
      this.currentStatus.state === 'available' ? this.currentStatus.version : this.availableVersion
    if (!version) {
      return
    }
    if (
      !this.availableUpdateCandidate ||
      this.availableUpdateCandidate.version !== version ||
      !this.isUpdateCandidateCurrent(this.availableUpdateCandidate)
    ) {
      this.clearAvailableUpdateContext()
      this.sendErrorStatus('Update source changed before download could start.', true)
      return
    }
    if (isExternallyManagedLinuxInstall()) {
      recordUpdaterLifecycle('linux_package_externally_managed_download_blocked', { version })
      const metadata = this.getHiveCloudStatusMetadata()
      this.restoreReleaseUpdateSource()
      this.sendStatus({
        state: 'error',
        ...updaterCodedMessage('linuxPackageExternallyManaged'),
        version,
        retryable: false,
        ...metadata
      })
      return
    }
    this.downloadingUpdateCandidate = this.availableUpdateCandidate
    this.downloadedUpdateCandidate = null
    if (this.deferHeadlessServeInstall('download', version)) {
      return
    }
    this.downloadInFlight = true
    const localBuildDownload = this.activeUpdateSource === 'local'
    beginMacUpdateDownload()
    this.sendStatus({
      state: 'downloading',
      percent: 0,
      version,
      ...this.getHiveCloudStatusMetadata()
    })
    const acceptedDownloadCandidate = this.downloadingUpdateCandidate
    const startDownload = (): void => {
      if (
        this.downloadingUpdateCandidate !== acceptedDownloadCandidate ||
        !this.isUpdateCandidateCurrent(acceptedDownloadCandidate)
      ) {
        return
      }
      this.getAutoUpdater()
        .downloadUpdate()
        .catch((err) => {
          this.downloadInFlight = false
          const message = String(err?.message ?? err)
          if (localBuildDownload) {
            this.sendLocalBuildErrorAndRestore(message)
          } else {
            this.sendErrorStatus(message)
          }
        })
    }
    const preparingStaging = this.isMacStagingDeferredToInstall()
      ? null
      : prepareThisProcessShipItStaging()
    if (preparingStaging) {
      void preparingStaging
        .then((approved) => {
          if (
            this.downloadingUpdateCandidate !== acceptedDownloadCandidate ||
            !this.isUpdateCandidateCurrent(acceptedDownloadCandidate)
          ) {
            return
          }
          if (process.platform === 'darwin' && approved !== true) {
            this.downloadInFlight = false
            this.downloadingUpdateCandidate = null
            this.sendErrorStatus('macOS staging preparation was not approved.', true)
            return
          }
          startDownload()
        })
        .catch((error) => {
          if (this.downloadingUpdateCandidate !== acceptedDownloadCandidate) {
            return
          }
          this.downloadingUpdateCandidate = null
          this.downloadInFlight = false
          this.sendErrorStatus(String(error), true)
        })
    } else if (process.platform === 'darwin' && !this.isMacStagingDeferredToInstall()) {
      this.downloadInFlight = false
      this.downloadingUpdateCandidate = null
      this.sendErrorStatus('macOS staging preparation was not approved.', true)
    } else {
      startDownload()
    }
  }

  protected isQuittingForUpdate(): boolean {
    return this.quittingForUpdate
  }
}
