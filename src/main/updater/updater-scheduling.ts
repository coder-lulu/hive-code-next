import { app } from 'electron'
import { hasConfiguredProductUpdateChannel } from '../../shared/product-update-policy'
import { withUpdaterSpan } from '../observability/instrumentation'
import { isMacInstallRequested } from '../updater-mac-install'
import { UpdaterCheckFailure } from './updater-check-failure'
import {
  AUTO_UPDATE_CHECK_INTERVAL_MS,
  AUTO_UPDATE_RETRY_INTERVAL_MS,
  MAX_AUTO_UPDATE_RETRY_INTERVAL_MS
} from './updater-state'
import type { UpdateCheckVariant } from './updater-types'

export abstract class UpdaterScheduling extends UpdaterCheckFailure {
  protected getAutomaticRetryInterval(): number {
    return AUTO_UPDATE_RETRY_INTERVAL_MS
  }

  protected scheduleAutomaticUpdateCheck(delayMs: number): void {
    let effectiveDelayMs = delayMs
    if (delayMs === AUTO_UPDATE_RETRY_INTERVAL_MS) {
      effectiveDelayMs = Math.min(
        AUTO_UPDATE_RETRY_INTERVAL_MS * 2 ** this.consecutiveAutomaticRetrySchedules,
        MAX_AUTO_UPDATE_RETRY_INTERVAL_MS
      )
      this.consecutiveAutomaticRetrySchedules += 1
    }
    if (this.autoUpdateCheckTimer) {
      clearTimeout(this.autoUpdateCheckTimer)
    }
    const scheduleGeneration = ++this.autoUpdateCheckScheduleGeneration
    this.autoUpdateCheckTimer = setTimeout(() => {
      if (scheduleGeneration !== this.autoUpdateCheckScheduleGeneration) {
        return
      }
      this.autoUpdateCheckTimer = null
      if (!this.runBackgroundUpdateCheck()) {
        this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
      }
    }, effectiveDelayMs)
  }

  protected recordCompletedUpdateCheck(): void {
    this.consecutiveAutomaticRetrySchedules = 0
    this.persistLastUpdateCheckAt?.(Date.now())
  }

  /** Returns false when the check was deferred instead of launched, so timer-driven callers can re-arm. */
  protected runBackgroundUpdateCheck(
    nudgeId: string | null = this.getPersistedPendingUpdateNudgeId()
  ): boolean {
    if (
      this.pendingQuitAndInstallTimer ||
      this.quitAndInstallInProgress ||
      isMacInstallRequested()
    ) {
      return false
    }
    if (!this.releaseUpdaterServicesInitialized || !hasConfiguredProductUpdateChannel()) {
      return false
    }
    if (
      this.activeUpdateSource !== 'release' ||
      this.isPinnedBuildActive ||
      this.localBuildSelectionInProgress ||
      this.pinnedBuildSelectionInProgress
    ) {
      return false
    }
    if (this.backgroundCheckLaunchPending || this.currentStatus.state === 'checking') {
      return false
    }
    if (!app.isPackaged) {
      this.sendSettledCheckStatus({ state: 'not-available' })
      return false
    }
    this.activeUpdateNudgeId = nudgeId
    this.backgroundCheckLaunchPending = true
    this.backgroundCheckPromotedToUserInitiated = false
    const attemptId = this.beginUpdateCheckAttempt(true)
    const checkVariant = this.getUpdateCheckVariant()
    this.applyUpdateCheckVariant(checkVariant)
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
      if (preflightResult === 'ready') {
        return launch()
      }
      if (preflightResult === 'not-available' && this.isActiveUpdateCheckAttempt(attemptId)) {
        this.backgroundCheckLaunchPending = false
        this.finishActiveUpdateCheckAttempt()
        this.recordCompletedUpdateCheck()
        this.sendSettledCheckStatus({ state: 'not-available' })
        this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
      }
      return undefined
    })
    void Promise.resolve(run)
      .then(() => this.handleSettledUpdateCheckPromise(attemptId))
      .catch((err) => {
        if (!this.isActiveUpdateCheckAttempt(attemptId)) {
          return
        }
        const wasUserInitiated = this.getSettledCheckUserInitiated()
        this.backgroundCheckLaunchPending = false
        this.backgroundCheckPromotedToUserInitiated = false
        if (wasUserInitiated) {
          this.userInitiatedCheck = false
        }
        void this.sendCheckFailureStatus(
          String(err?.message ?? err),
          wasUserInitiated,
          'promise',
          err
        )
      })
    return true
  }

  protected checkForUpdatesInBackground(): void {
    // This span measures launch, not check outcome; dashboards must filter updater.outcome=launched.
    void withUpdaterSpan({ stage: 'check' }, async (span) => {
      span.setAttribute('updater.outcome', 'launched')
      this.runBackgroundUpdateCheck()
    })
  }

  protected enablePrereleaseManifestChecks(): void {
    this.getAutoUpdater().allowPrerelease = true
  }

  protected enableIncludePrerelease(): void {
    if (this.includePrereleaseActive) {
      return
    }
    // Allow prerelease manifests on the probed generic feed; native GitHub may select cancelled RCs without assets.
    this.enablePrereleaseManifestChecks()
    this.includePrereleaseActive = true
  }

  protected applyUpdateCheckVariant(variant: UpdateCheckVariant): void {
    this.getAutoUpdater().allowPrerelease = variant !== 'default'
  }

  protected cancelAutomaticUpdateCheckTimer(): void {
    this.autoUpdateCheckScheduleGeneration += 1
    if (this.autoUpdateCheckTimer) {
      clearTimeout(this.autoUpdateCheckTimer)
      this.autoUpdateCheckTimer = null
    }
  }
}
