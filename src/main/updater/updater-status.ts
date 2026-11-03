import { hasConfiguredProductUpdateChannel } from '../../shared/product-update-policy'
import { resolveProductUpdateSource } from '../../shared/product-update-source'
import type { UpdateCheckOptions, UpdateStatus } from '../../shared/update-status-types'
import { loadElectronAutoUpdater, type ElectronAutoUpdater } from '../electron-updater-loader'
import { statusesEqual } from '../updater-fallback'
import type { UpdateCandidateIdentity } from './updater-state'
import { UpdaterState as BaseUpdaterState } from './updater-state'
import type { UpdateCheckVariant } from './updater-types'

export abstract class UpdaterStatus extends BaseUpdaterState {
  protected getAutoUpdater(): ElectronAutoUpdater {
    if (!this.autoUpdater) {
      this.autoUpdater = loadElectronAutoUpdater()
    }
    return this.autoUpdater
  }

  protected clearAvailableUpdateContext(): void {
    this.availableVersion = null
    this.availableReleaseUrl = null
    this.availableUpdateCandidate = null
    this.downloadingUpdateCandidate = null
    this.downloadedUpdateCandidate = null
    this.pendingHiveCloudDecision = null
  }

  protected closeLocalBuildFeed(): void {
    const feed = this.activeLocalBuildFeed
    this.activeLocalBuildFeed = null
    if (feed) {
      void feed.close()
    }
  }

  protected restoreReleaseUpdateSource(): void {
    this.clearAvailableUpdateContext()
    this.clearHiveCloudDecision()
    this.closeLocalBuildFeed()
    this.advanceUpdateAuthorityEpoch()
    this.activeUpdateSource = 'release'
    this.activeReleaseFeedUrl = null
    this.isPinnedBuildActive = false
    if (this.autoUpdater) {
      this.autoUpdater.allowDowngrade = false
      this.autoUpdater.disableDifferentialDownload = true
      this.autoUpdater.allowPrerelease = false
    }
  }

  protected sendLocalBuildErrorAndRestore(message: string, userInitiated?: boolean): void {
    this.clearAvailableUpdateContext()
    if (
      this.currentStatus.state !== 'error' ||
      this.currentStatus.message !== message ||
      this.currentStatus.userInitiated !== userInitiated ||
      this.currentStatus.source !== 'local'
    ) {
      this.sendStatus({ state: 'error', message, userInitiated, source: 'local' })
    }
    this.restoreReleaseUpdateSource()
  }

  protected clearPrereleaseFallbackContext(): void {
    this.pendingPrereleaseFallback = null
  }

  protected clearPendingUpdateNudge(): void {
    this.activeUpdateNudgeId = null
    this.awaitingNudgeCheckOutcome = false
    this._setPendingUpdateNudgeId?.(null)
  }

  protected deferPendingUpdateNudgeUntilRetry(): void {
    this.activeUpdateNudgeId = null
    this.awaitingNudgeCheckOutcome = false
  }

  protected clearPublishingWindowLastGoodCheck(): void {
    this.publishingWindowLastGoodCheck = null
  }

  protected getPublishingWindowLastGoodCheck(): { lastGoodTag: string } | null {
    return this.publishingWindowLastGoodCheck
  }

  protected getPersistedPendingUpdateNudgeId(): string | null {
    return this._getPendingUpdateNudgeId?.() ?? null
  }

  protected decorateStatusWithActiveNudge(status: UpdateStatus): UpdateStatus {
    // Attach campaign IDs only to actionable/error states whose dismissal acknowledges them.
    if (!this.activeUpdateNudgeId) {
      return status
    }
    if (
      status.state === 'idle' ||
      status.state === 'disabled' ||
      status.state === 'checking' ||
      status.state === 'not-available'
    ) {
      return status
    }
    return { ...status, activeNudgeId: this.activeUpdateNudgeId }
  }

  /** `force` re-delivers a status the renderer must not miss even when it repeats the current one. */
  protected sendStatus(status: UpdateStatus, options?: { force?: boolean }): void {
    const pendingUserInitiatedCheckVariant = this.pendingUserInitiatedCheckAfterInFlight
    const shouldLaunchPendingUserInitiatedCheck =
      pendingUserInitiatedCheckVariant !== null &&
      (status.state === 'idle' ||
        status.state === 'not-available' ||
        status.state === 'available' ||
        status.state === 'error')
    const shouldPreserveNudgeForPublishingWindow =
      this.publishingWindowLastGoodCheck !== null &&
      (status.state === 'idle' ||
        status.state === 'not-available' ||
        status.state === 'available' ||
        status.state === 'error')
    if (this.awaitingNudgeCheckOutcome) {
      if (status.state === 'available') {
        if (shouldPreserveNudgeForPublishingWindow) {
          // Dismissing a temporary last-good update must not consume the newest-release campaign.
          this.deferPendingUpdateNudgeUntilRetry()
        } else {
          this.awaitingNudgeCheckOutcome = false
        }
      } else if (
        status.state === 'idle' ||
        status.state === 'not-available' ||
        status.state === 'error'
      ) {
        if (shouldPreserveNudgeForPublishingWindow) {
          // Last-good not-available may precede the newest campaign release finishing publication.
          this.deferPendingUpdateNudgeUntilRetry()
        } else {
          // A no-update result consumes the campaign so up-to-date users are not nudged every poll.
          if (this.activeUpdateNudgeId) {
            this._setDismissedUpdateNudgeId?.(this.activeUpdateNudgeId)
          }
          this.clearPendingUpdateNudge()
        }
      }
    }

    const sourcedStatus: UpdateStatus =
      this.activeUpdateSource === 'release'
        ? status
        : { ...status, source: this.activeUpdateSource }
    const decoratedStatus = this.decorateStatusWithActiveNudge(sourcedStatus)

    if (this.isUpdateCheckResultState(status.state)) {
      this.finishActiveUpdateCheckAttempt()
    }

    if (
      status.state === 'idle' ||
      status.state === 'not-available' ||
      status.state === 'available' ||
      status.state === 'error'
    ) {
      this.clearPublishingWindowLastGoodCheck()
    }

    // Release the duplicate guard after the download-start transition.
    if (
      decoratedStatus.state === 'downloading' ||
      decoratedStatus.state === 'error' ||
      decoratedStatus.state === 'idle'
    ) {
      this.downloadInFlight = false
    }
    if (shouldLaunchPendingUserInitiatedCheck) {
      // Deliver forced status before a queued check starts the next cycle.
      if (options?.force) {
        this.currentStatus = decoratedStatus
        this.sendToMainWindow('updater:status', decoratedStatus)
      }
      this.launchPendingUserInitiatedCheckAfterInFlight(pendingUserInitiatedCheckVariant)
      return
    }
    if (!options?.force && statusesEqual(this.currentStatus, decoratedStatus)) {
      return
    }
    this.currentStatus = decoratedStatus
    this.sendToMainWindow('updater:status', decoratedStatus)
  }

  protected abstract finishActiveUpdateCheckAttempt(): void
  protected abstract isActiveUpdateCheckAttempt(attemptId: number): boolean
  protected abstract isUpdateCheckResultState(state: UpdateStatus['state']): boolean
  protected abstract launchPendingUserInitiatedCheckAfterInFlight(variant: UpdateCheckVariant): void
  protected abstract checkForUpdatesFromMenu(options?: UpdateCheckOptions): void

  protected acceptDownloadedUpdateCandidate(version: string): boolean {
    if (
      !this.downloadingUpdateCandidate ||
      this.downloadingUpdateCandidate.version !== version ||
      !this.isUpdateCandidateCurrent(this.downloadingUpdateCandidate)
    ) {
      this.clearAvailableUpdateContext()
      return false
    }
    this.downloadedUpdateCandidate = this.downloadingUpdateCandidate
    return true
  }

  protected isUpdateCandidateCurrent(candidate: UpdateCandidateIdentity): boolean {
    if (candidate.authorityEpoch !== this.updateAuthorityEpoch) {
      return false
    }
    if (candidate.kind === 'local') {
      return (
        this.activeUpdateSource === 'local' && this.activeLocalBuildFeed?.url === candidate.feedUrl
      )
    }
    const source = hasConfiguredProductUpdateChannel() ? resolveProductUpdateSource() : null
    if (!source) {
      return false
    }
    if (candidate.kind === 'pinned') {
      return this.isPinnedBuildActive && this.activeUpdateSource === candidate.source
    }
    if (source.provider === 'hivecloud') {
      return (
        this.activeUpdateSource === 'release' &&
        !this.isPinnedBuildActive &&
        candidate.provider === 'hivecloud' &&
        candidate.repository === null &&
        candidate.sourceChannel === source.channel &&
        candidate.feedUrl === this.activeReleaseFeedUrl &&
        candidate.overrideChannel === (this.getReleaseChannelOverride?.() ?? null)
      )
    }
    if (!source.github) {
      return false
    }
    return (
      this.activeUpdateSource === 'release' &&
      !this.isPinnedBuildActive &&
      candidate.provider === 'github' &&
      candidate.repository === source.github.repo &&
      candidate.sourceChannel === source.channel &&
      candidate.overrideChannel === (this.getReleaseChannelOverride?.() ?? null)
    )
  }

  protected acceptAvailableUpdateCandidate(version: string): void {
    if (
      !this.expectedUpdateOffer ||
      !this.isActiveUpdateCheckAttempt(this.expectedUpdateOffer.generation) ||
      this.expectedUpdateOffer.version !== version ||
      !this.isUpdateCandidateCurrent(this.expectedUpdateOffer)
    ) {
      this.clearAvailableUpdateContext()
      return
    }
    this.availableVersion = version
    this.availableUpdateCandidate = this.expectedUpdateOffer
    this.downloadingUpdateCandidate = null
    this.downloadedUpdateCandidate = null
  }

  protected isExpectedUpdateOffer(attemptId: number, version: string): boolean {
    return (
      this.expectedUpdateOffer?.generation === attemptId &&
      this.expectedUpdateOffer.version === version
    )
  }

  protected setExpectedUpdateOffer(candidate: UpdateCandidateIdentity): void {
    if (this.isActiveUpdateCheckAttempt(candidate.generation)) {
      this.expectedUpdateOffer = candidate
    }
  }

  protected getHiveCloudStatusMetadata(): Pick<
    UpdateStatus,
    | 'mandatory'
    | 'minimumSupportedBuild'
    | 'latestBuild'
    | 'releaseNotes'
    | 'channel'
    | 'blockReason'
  > {
    const decision = this.pendingHiveCloudDecision ?? this.activeHiveCloudDecision
    if (!decision?.latest) {
      return {}
    }
    const source = decision ? resolveProductUpdateSource() : null
    return {
      mandatory:
        decision?.hasUpdate && (decision.updateRequired || decision.latest.mandatory)
          ? true
          : undefined,
      minimumSupportedBuild: decision?.minimumSupportedBuild ?? undefined,
      latestBuild: decision?.latest?.buildNumber,
      releaseNotes: decision?.latest?.releaseNotes,
      channel: source?.channel,
      blockReason: decision?.blockReason ?? undefined
    }
  }

  protected clearHiveCloudDecision(): void {
    this.pendingHiveCloudDecision = null
    this.activeHiveCloudDecision = null
  }

  protected advanceUpdateAuthorityEpoch(): void {
    if (this.updateAuthorityEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Updater authority epoch exhausted')
    }
    this.updateAuthorityEpoch += 1
  }

  protected getProductUpdaterNetworkMode(): 'release' | 'local' {
    return this.activeUpdateSource === 'local' ? 'local' : 'release'
  }

  reportReleaseUpdatesDisabled(): void {
    this.sendStatus({ state: 'disabled', reason: 'not-configured' })
  }
}
