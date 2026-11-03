import { app } from 'electron'
import { resolveProductUpdateSource } from '../../shared/product-update-source'
import { isMissingUpdateManifestFailure } from '../updater-fallback'
import {
  fetchNewerReleaseTagsWithReadiness,
  getReleaseDownloadUrl
} from '../updater-prerelease-feed'
import { UpdaterProductFeed } from './updater-product-feed'
import type { CheckFailureSource, ReleaseFeedPreflightResult } from './updater-state'
import { ReleaseFeedPreflightError } from './updater-state'
import type { UpdateCheckVariant } from './updater-types'

export abstract class UpdaterReleaseFeed extends UpdaterProductFeed {
  protected clearPrereleaseFallbackContextIfSettled(): void {
    if (
      this.pendingPrereleaseFallback?.fallbackResultHandled &&
      !this.pendingPrereleaseFallback.suppressedPrimaryPromiseFailureKey &&
      !this.pendingPrereleaseFallback.suppressedPrimaryEventFailure &&
      !this.pendingPrereleaseFallback.suppressedFallbackPromiseFailureKey &&
      !this.pendingPrereleaseFallback.suppressedFallbackEventFailureKey
    ) {
      this.clearPrereleaseFallbackContext()
    }
  }

  protected getMissingManifestPrereleaseFallbackUserInitiated(): boolean | null {
    if (
      !this.pendingPrereleaseFallback?.retryLaunched ||
      this.pendingPrereleaseFallback.fallbackResultHandled
    ) {
      return null
    }
    return this.pendingPrereleaseFallback.userInitiated
  }

  protected markMissingManifestPrereleaseFallbackChecking(): void {
    if (
      !this.pendingPrereleaseFallback?.retryLaunched ||
      this.pendingPrereleaseFallback.fallbackResultHandled
    ) {
      return
    }
    this.pendingPrereleaseFallback.fallbackCheckingForUpdateSeen = true
  }

  protected consumeMissingManifestPrereleaseFallbackResult(): { userInitiated: boolean } | null {
    if (
      !this.pendingPrereleaseFallback?.retryLaunched ||
      this.pendingPrereleaseFallback.fallbackResultHandled
    ) {
      return null
    }
    const result = { userInitiated: this.pendingPrereleaseFallback.userInitiated }
    this.pendingPrereleaseFallback.fallbackResultHandled = true
    this.clearPrereleaseFallbackContextIfSettled()
    return result
  }

  protected suppressMissingManifestPrereleaseFallbackPromiseFailure(message: string): void {
    if (
      !this.pendingPrereleaseFallback?.retryLaunched ||
      this.pendingPrereleaseFallback.fallbackResultHandled
    ) {
      return
    }
    this.pendingPrereleaseFallback.suppressedFallbackPromiseFailureKey = this.getCheckFailureKey(
      message,
      this.pendingPrereleaseFallback.userInitiated
    )
  }

  protected shouldSuppressMissingManifestPrereleaseFallbackEvent(
    message: string,
    error: unknown
  ): boolean {
    if (!this.pendingPrereleaseFallback?.retryLaunched) {
      return false
    }
    const failureKey = this.getCheckFailureKey(
      message,
      this.pendingPrereleaseFallback.userInitiated
    )
    const primaryEventSuppression = this.pendingPrereleaseFallback.suppressedPrimaryEventFailure
    if (primaryEventSuppression?.failureKey === failureKey) {
      const isPrimaryPromisePair = primaryEventSuppression.error === error
      // After fallback starts, identical messages may be its own errors; message matching alone is unsafe.
      if (isPrimaryPromisePair || !this.pendingPrereleaseFallback.fallbackCheckingForUpdateSeen) {
        this.pendingPrereleaseFallback.suppressedPrimaryEventFailure = null
        this.clearPrereleaseFallbackContextIfSettled()
        return true
      }
    }
    if (this.pendingPrereleaseFallback.suppressedFallbackEventFailureKey === failureKey) {
      this.pendingPrereleaseFallback.suppressedFallbackEventFailureKey = null
      this.clearPrereleaseFallbackContextIfSettled()
      return true
    }
    return false
  }

  protected markMissingManifestPrereleaseFallbackPromiseHandled(message: string): void {
    if (
      !this.pendingPrereleaseFallback?.retryLaunched ||
      this.pendingPrereleaseFallback.fallbackResultHandled
    ) {
      return
    }
    this.pendingPrereleaseFallback.suppressedFallbackEventFailureKey = this.getCheckFailureKey(
      message,
      this.pendingPrereleaseFallback.userInitiated
    )
  }

  protected async pinDefaultReleaseFeed(
    variant: UpdateCheckVariant,
    attemptId: number
  ): Promise<ReleaseFeedPreflightResult> {
    const source = resolveProductUpdateSource()
    if (source?.provider === 'hivecloud') {
      this.clearPrereleaseFallbackContext()
      this.clearPublishingWindowLastGoodCheck()
      return this.prepareHiveCloudReleaseFeed(variant, attemptId)
    }
    if (source?.provider !== 'github' || !source.github) {
      throw new Error('Product update source is not configured')
    }
    const currentVersion = app.getVersion()
    const isPerfCheck = variant === 'perf'
    const includePrerelease = variant !== 'default'
    const releaseTagsResult = await fetchNewerReleaseTagsWithReadiness(
      currentVersion,
      includePrerelease ? 2 : 1,
      {
        includePrerelease,
        ...(isPerfCheck ? { releaseFilter: 'perf' as const } : {})
      }
    )
    if (!this.canCommitReleaseFeedForAttempt(attemptId)) {
      return 'superseded'
    }
    const newerTag = releaseTagsResult.tags[0] ?? null
    const fallbackTag = includePrerelease ? (releaseTagsResult.tags[1] ?? null) : null
    this.pendingPrereleaseFallback =
      includePrerelease && newerTag && fallbackTag
        ? {
            primaryTag: newerTag,
            fallbackTag,
            variant,
            userInitiated: false,
            suppressedPrimaryPromiseFailureKey: null,
            suppressedPrimaryEventFailure: null,
            suppressedFallbackPromiseFailureKey: null,
            suppressedFallbackEventFailureKey: null,
            fallbackResultHandled: false,
            fallbackCheckingForUpdateSeen: false,
            retryLaunched: false
          }
        : null
    if (newerTag) {
      this.clearPublishingWindowLastGoodCheck()
      const url = getReleaseDownloadUrl(newerTag)
      if (!url) {
        throw new Error('Product update tag download base is not configured')
      }
      if (!this.commitReleaseFeedForAttempt(attemptId, url, newerTag, variant)) {
        return 'superseded'
      }
      console.info(
        `[updater] release feed pinned: current=${currentVersion} includePrerelease=${includePrerelease} → ${url}`
      )
      return 'ready'
    }
    this.clearPrereleaseFallbackContext()
    if (releaseTagsResult.state === 'not-ready') {
      if (releaseTagsResult.lastGoodTag) {
        const url = getReleaseDownloadUrl(releaseTagsResult.lastGoodTag)
        if (!url) {
          throw new Error('Product update tag download base is not configured')
        }
        if (
          !this.commitReleaseFeedForAttempt(attemptId, url, releaseTagsResult.lastGoodTag, variant)
        ) {
          return 'superseded'
        }
        this.publishingWindowLastGoodCheck = { lastGoodTag: releaseTagsResult.lastGoodTag }
        console.info(
          `[updater] release feed pinned to last-good: current=${currentVersion} includePrerelease=${includePrerelease} → ${url}`
        )
        return 'ready'
      }
      this.clearPublishingWindowLastGoodCheck()
      throw new ReleaseFeedPreflightError(
        'release-not-ready',
        variant,
        'Latest release artifacts are not ready'
      )
    }
    this.clearPublishingWindowLastGoodCheck()
    if (releaseTagsResult.state === 'no-newer') {
      if (releaseTagsResult.currentTag) {
        const url = getReleaseDownloadUrl(releaseTagsResult.currentTag)
        if (!url) {
          throw new Error('Product update tag download base is not configured')
        }
        if (
          !this.commitReleaseFeedForAttempt(attemptId, url, releaseTagsResult.currentTag, variant)
        ) {
          return 'superseded'
        }
        return 'ready'
      }
      console.info(
        `[updater] release not found: current=${currentVersion} includePrerelease=${includePrerelease}`
      )
      return 'not-available'
    }
    if (releaseTagsResult.state === 'unavailable') {
      throw new ReleaseFeedPreflightError(
        releaseTagsResult.unavailableReason === 'manifest'
          ? 'manifest-unavailable'
          : 'feed-unavailable',
        variant,
        'Unable to resolve a verified update feed'
      )
    }
    throw new ReleaseFeedPreflightError(
      'feed-unavailable',
      variant,
      'Unable to resolve a verified update feed'
    )
  }

  protected retryPrereleaseFallbackAfterMissingManifest(
    message: string,
    userInitiated: boolean | undefined,
    source: CheckFailureSource,
    failureKey: string,
    sourceError?: unknown
  ): boolean {
    if (
      !this.pendingPrereleaseFallback ||
      this.pendingPrereleaseFallback.retryLaunched ||
      !isMissingUpdateManifestFailure(message)
    ) {
      return false
    }
    const attemptId = this.activeUpdateCheckAttemptId
    if (attemptId === null) {
      return false
    }
    const { primaryTag, fallbackTag } = this.pendingPrereleaseFallback
    const url = getReleaseDownloadUrl(fallbackTag)
    if (!url || !this.canCommitReleaseFeedForAttempt(attemptId)) {
      return false
    }
    this.pendingPrereleaseFallback.retryLaunched = true
    this.pendingPrereleaseFallback.userInitiated = Boolean(userInitiated)
    this.pendingPrereleaseFallback.suppressedPrimaryPromiseFailureKey =
      source === 'event' ? failureKey : null
    this.pendingPrereleaseFallback.suppressedPrimaryEventFailure =
      source === 'promise' ? { failureKey, error: sourceError } : null
    this.pendingPrereleaseFallback.fallbackCheckingForUpdateSeen = false
    console.info(
      `[updater] prerelease manifest missing for ${primaryTag}; retrying once against ${url}`
    )
    const autoUpdater = this.getAutoUpdater()
    if (
      !this.commitReleaseFeedForAttempt(
        attemptId,
        url,
        fallbackTag,
        this.pendingPrereleaseFallback.variant
      )
    ) {
      return false
    }
    this.userInitiatedCheck = Boolean(userInitiated)
    this.backgroundCheckLaunchPending = !userInitiated
    this.armUpdateCheckStallTimer(attemptId)
    this.markUpdateCheckLaunched(attemptId)
    void autoUpdater
      .checkForUpdates()
      .then(() => this.handleSettledUpdateCheckPromise(attemptId))
      .catch((err) => {
        if (!this.isActiveUpdateCheckAttempt(attemptId)) {
          return
        }
        const message = String(err?.message ?? err)
        if (userInitiated) {
          this.userInitiatedCheck = false
        } else {
          this.backgroundCheckLaunchPending = false
        }
        this.markMissingManifestPrereleaseFallbackPromiseHandled(message)
        this.consumeMissingManifestPrereleaseFallbackResult()
        void this.sendCheckFailureStatus(message, userInitiated, 'fallback-promise', err)
      })
    return true
  }
}
