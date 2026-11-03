import { app } from 'electron'
import { hasConfiguredProductUpdateChannel } from '../../shared/product-update-policy'
import type { ReleaseChannel } from '../../shared/release-channel'
import type { UpdateCheckOptions } from '../../shared/update-status-types'
import { isMacInstallRequested } from '../updater-mac-install'
import { UpdaterScheduling } from './updater-scheduling'

export abstract class UpdaterMenuChecks extends UpdaterScheduling {
  protected checkForUpdatesFromMenu(options?: UpdateCheckOptions): void {
    if (
      this.pendingQuitAndInstallTimer ||
      this.quitAndInstallInProgress ||
      isMacInstallRequested()
    ) {
      return
    }
    if (!app.isPackaged) {
      this.sendSettledCheckStatus({ state: 'not-available', userInitiated: true })
      return
    }
    if (options?.localBuild) {
      void this.checkForLocalBuildFromMenu()
      return
    }
    if (!this.releaseUpdaterServicesInitialized || !hasConfiguredProductUpdateChannel()) {
      this.reportReleaseUpdatesDisabled()
      return
    }
    if (options?.targetTag && options.channel) {
      void this.checkForPinnedBuild(options.channel, options.targetTag)
      return
    }
    if (this.localBuildSelectionInProgress || this.pinnedBuildSelectionInProgress) {
      return
    }
    if (
      this.activeUpdateSource !== 'release' &&
      (this.currentStatus.state === 'checking' || this.currentStatus.state === 'downloading')
    ) {
      return
    }
    this.restoreReleaseUpdateSource()
    const checkVariant = this.getUpdateCheckVariant(options)
    this.applyUpdateCheckVariant(checkVariant)
    if (checkVariant === 'prerelease') {
      this.clearPrereleaseFallbackContext()
    } else if (checkVariant === 'perf') {
      this.clearPrereleaseFallbackContext()
    }
    const checkAlreadyInFlight =
      this.backgroundCheckLaunchPending || this.currentStatus.state === 'checking'
    this.userInitiatedCheck = true
    this.activeUpdateNudgeId = null
    this.sendStatus({ state: 'checking', userInitiated: true })
    if (checkAlreadyInFlight) {
      this.backgroundCheckPromotedToUserInitiated = true
      this.rearmActiveUpdateCheckStallTimer()
      if (checkVariant !== 'default') {
        this.pendingUserInitiatedCheckAfterInFlight = checkVariant
      }
      return
    }
    const attemptId = this.beginUpdateCheckAttempt()
    const autoUpdater = this.getAutoUpdater()
    const launch = (): Promise<unknown> | undefined => {
      if (
        this.pendingQuitAndInstallTimer ||
        this.quitAndInstallInProgress ||
        isMacInstallRequested()
      ) {
        return undefined
      }
      if (!this.isActiveUpdateCheckAttempt(attemptId)) {
        return undefined
      }
      this.markUpdateCheckLaunched(attemptId)
      return autoUpdater.checkForUpdates()
    }
    const run = this.pinDefaultReleaseFeed(checkVariant, attemptId).then((preflightResult) => {
      if (preflightResult === 'not-available') {
        if (!this.isActiveUpdateCheckAttempt(attemptId)) {
          return false
        }
        this.userInitiatedCheck = false
        this.finishActiveUpdateCheckAttempt()
        this.recordCompletedUpdateCheck()
        this.sendSettledCheckStatus({ state: 'not-available', userInitiated: true })
        return false
      }
      return launch()
    })
    void Promise.resolve(run)
      .then((launchResult) => {
        if (launchResult === false) {
          return
        }
        this.handleSettledUpdateCheckPromise(attemptId)
      })
      .catch((err) => {
        if (!this.isActiveUpdateCheckAttempt(attemptId)) {
          return
        }
        this.userInitiatedCheck = false
        void this.sendCheckFailureStatus(String(err?.message ?? err), true, 'promise', err)
      })
  }

  protected abstract checkForLocalBuildFromMenu(): Promise<void>
  protected abstract checkForPinnedBuild(channel: ReleaseChannel, tag: string): Promise<void>
}
