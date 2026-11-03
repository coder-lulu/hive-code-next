import { app } from 'electron'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import { hasConfiguredProductUpdateChannel } from '../../shared/product-update-policy'
import { resolveProductUpdateSource } from '../../shared/product-update-source'
import { profileStateBuildCompatibilityError } from '../../shared/profile-state-build-compatibility'
import {
  DEV_CHANNEL_PLATFORM_LABEL,
  getVersionChannel,
  hasDedicatedReleaseRepo,
  isChannelSupportedOnPlatform,
  RELEASE_CHANNEL_LABELS,
  requiresManualDevChannelInstall,
  type ReleaseBuild,
  type ReleaseChannel
} from '../../shared/release-channel'
import { compareVersions } from '../updater-fallback'
import { ReleaseBuildListCache, type ReleaseBuildListOptions } from '../updater-release-build-cache'
import { listReleaseBuilds, resolveTargetBuild } from '../updater-release-builds'
import { UpdaterMenuChecks } from './updater-menu-checks'

export abstract class UpdaterBuildSelection extends UpdaterMenuChecks {
  private readonly releaseBuildCache = new ReleaseBuildListCache((channel) =>
    listReleaseBuilds(channel)
  )

  protected async checkForLocalBuildFromMenu(): Promise<void> {
    if (process.platform !== 'darwin') {
      this.sendLocalBuildErrorAndRestore(
        'Local build switching is currently available only on macOS.',
        true
      )
      return
    }
    if (this.currentStatus.state === 'checking' || this.currentStatus.state === 'downloading') {
      return
    }
    if (this.localBuildSelectionInProgress) {
      return
    }
    this.localBuildSelectionInProgress = true
    try {
      const [{ chooseLocalBuild }, { startLocalBuildFeed }] = await Promise.all([
        import('../local-builds/local-build-switch'),
        import('../local-builds/local-build-feed-server')
      ])
      const candidate = await chooseLocalBuild(this.mainWindowRef)
      if (!candidate) {
        return
      }
      const compatibilityError = profileStateBuildCompatibilityError(
        app.getVersion(),
        candidate.version
      )
      if (compatibilityError) {
        await candidate.close()
        throw new Error(compatibilityError)
      }
      this.closeLocalBuildFeed()
      const feed = await startLocalBuildFeed(candidate)
      this.advanceUpdateAuthorityEpoch()
      this.activeLocalBuildFeed = feed
      this.activeUpdateSource = 'local'
      this.activeReleaseFeedUrl = null
      this.clearPrereleaseFallbackContext()
      this.clearPublishingWindowLastGoodCheck()
      this.clearAvailableUpdateContext()
      this.activeUpdateNudgeId = null
      this.userInitiatedCheck = true
      this.sendStatus({ state: 'checking', userInitiated: true })
      const updater = this.getAutoUpdater()
      updater.allowDowngrade = true
      updater.disableDifferentialDownload = true
      updater.setFeedURL({ provider: 'generic', url: feed.url })
      const attemptId = this.beginUpdateCheckAttempt()
      this.setExpectedUpdateOffer({
        generation: attemptId,
        authorityEpoch: this.updateAuthorityEpoch,
        kind: 'local',
        provider: null,
        source: 'local',
        repository: null,
        sourceChannel: null,
        checkChannel: 'local',
        tag: `local:${candidate.version}`,
        version: candidate.version,
        feedUrl: feed.url,
        overrideChannel: null
      })
      this.markUpdateCheckLaunched(attemptId)
      await updater.checkForUpdates()
      this.handleSettledUpdateCheckPromise(attemptId)
    } catch (error) {
      this.userInitiatedCheck = false
      this.sendLocalBuildErrorAndRestore(String((error as Error)?.message ?? error), true)
    } finally {
      this.localBuildSelectionInProgress = false
    }
  }

  protected async listAvailableReleaseBuilds(
    channel: ReleaseChannel,
    options?: ReleaseBuildListOptions
  ): Promise<ReleaseBuild[]> {
    if (!this.releaseUpdaterServicesInitialized || !hasConfiguredProductUpdateChannel()) {
      return []
    }
    return this.releaseBuildCache.list(channel, options)
  }

  /** Pin any published channel/tag, including deliberate downgrades. */
  protected async checkForPinnedBuild(channel: ReleaseChannel, tag: string): Promise<void> {
    if (!app.isPackaged) {
      this.sendSettledCheckStatus({ state: 'not-available', userInitiated: true })
      return
    }
    if (!isChannelSupportedOnPlatform(channel, process.platform)) {
      this.sendStatus({
        state: 'error',
        message: `${RELEASE_CHANNEL_LABELS[channel]} builds are produced only for ${DEV_CHANNEL_PLATFORM_LABEL}.`,
        userInitiated: true
      })
      return
    }
    if (
      requiresManualDevChannelInstall({
        platform: process.platform,
        runningChannel: getVersionChannel(app.getVersion()),
        targetChannel: channel
      })
    ) {
      this.sendStatus({
        state: 'error',
        message: `${RELEASE_CHANNEL_LABELS[channel]} builds are unsigned, and this signed build only installs updates signed by ${APP_DISPLAY_NAME}'s publisher. Download the installer from the release page and run it once — updates work normally from there, including back to Stable.`,
        userInitiated: true
      })
      return
    }
    if (this.currentStatus.state === 'checking' || this.currentStatus.state === 'downloading') {
      return
    }
    if (this.localBuildSelectionInProgress || this.pinnedBuildSelectionInProgress) {
      return
    }
    this.pinnedBuildSelectionInProgress = true
    try {
      const target = resolveTargetBuild(channel, tag)
      const compatibilityError = profileStateBuildCompatibilityError(
        app.getVersion(),
        target.version
      )
      if (compatibilityError) {
        throw new Error(compatibilityError)
      }
      if (compareVersions(target.version, app.getVersion()) === 0) {
        this.sendSettledCheckStatus({ state: 'not-available', userInitiated: true })
        return
      }
      this.closeLocalBuildFeed()
      this.activeUpdateSource = hasDedicatedReleaseRepo(channel) ? channel : 'release'
      this.isPinnedBuildActive = true
      this.clearPrereleaseFallbackContext()
      this.clearPublishingWindowLastGoodCheck()
      this.clearAvailableUpdateContext()
      this.activeUpdateNudgeId = null
      this.userInitiatedCheck = true
      this.sendStatus({ state: 'checking', userInitiated: true })
      const updater = this.getAutoUpdater()
      updater.allowDowngrade = true
      updater.disableDifferentialDownload = true
      updater.allowPrerelease = true
      console.info(`[updater] pinned to ${channel} build ${target.tag} → ${target.feedUrl}`)
      this.advanceUpdateAuthorityEpoch()
      this.activeReleaseFeedUrl = target.feedUrl
      updater.setFeedURL({ provider: 'generic', url: target.feedUrl })
      this.availableReleaseUrl = target.feedUrl
      const attemptId = this.beginUpdateCheckAttempt()
      this.setExpectedUpdateOffer({
        generation: attemptId,
        authorityEpoch: this.updateAuthorityEpoch,
        kind: 'pinned',
        provider: resolveProductUpdateSource()?.provider ?? null,
        source: this.activeUpdateSource,
        repository: resolveProductUpdateSource()?.github?.repo ?? null,
        sourceChannel: resolveProductUpdateSource()?.channel ?? null,
        checkChannel: channel,
        tag: target.tag,
        version: target.version,
        feedUrl: target.feedUrl,
        overrideChannel: this.getReleaseChannelOverride?.() ?? null
      })
      this.markUpdateCheckLaunched(attemptId)
      await updater.checkForUpdates()
      this.handleSettledUpdateCheckPromise(attemptId)
    } catch (error) {
      this.userInitiatedCheck = false
      this.clearAvailableUpdateContext()
      this.restoreReleaseUpdateSource()
      this.sendSettledCheckStatus({
        state: 'error',
        message: String((error as Error)?.message ?? error),
        userInitiated: true
      })
    } finally {
      this.pinnedBuildSelectionInProgress = false
    }
  }
}
