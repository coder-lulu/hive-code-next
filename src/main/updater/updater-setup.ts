import type { BrowserWindow } from 'electron'
import { app, powerMonitor } from 'electron'
import { hasConfiguredProductUpdateChannel } from '../../shared/product-update-policy'
import * as productUpdateSourceModule from '../../shared/product-update-source'
import {
  resolveProductUpdateFeedUrl,
  resolveProductUpdateSource
} from '../../shared/product-update-source'
import type { ReleaseBuild, ReleaseChannel } from '../../shared/release-channel'
import type {
  RemoteServerUpdateInstallResult,
  RemoteServerUpdaterSnapshot,
  RemoteServerUpdateSupport
} from '../../shared/remote-server-update'
import type {
  LinuxPackageInstallInstructions,
  UpdateCheckOptions,
  UpdateStatus
} from '../../shared/update-status-types'
import { createUpdaterDiagnosticLogger } from '../linux-package-install-diagnostic'
import { getProductExternalServiceEndpoints } from '../product/product-external-service-endpoints'
import type { ProductUpdaterHttpExecutor } from '../product/product-updater-network-boundary'
import { installProductUpdaterNetworkBoundary } from '../product/product-updater-network-boundary'
import { getServeUpdateHandoffFailure } from '../serve-update-handoff'
import { registerAutoUpdaterHandlers } from '../updater-events'
import { recordUpdaterLifecycle } from '../updater-lifecycle-diagnostics'
import type { ReleaseBuildListOptions } from '../updater-release-build-cache'
import { handleElectronUpdaterProxyLogin } from './electron-updater-proxy-session'
import { configureMacShipItScheduling } from './macos-shipit-scheduling'
import { UpdaterDownloadInstall } from './updater-download-install'
import type { PreQuitCleanupFailureMode, UpdateInstallMode } from './updater-state'
import { AUTO_UPDATE_CHECK_INTERVAL_MS } from './updater-state'

export type UpdaterSetupOptions = {
  localOnly?: boolean
  getLastUpdateCheckAt?: () => number | null
  onBeforeQuit?: () => void | Promise<void>
  setLastUpdateCheckAt?: (timestamp: number) => void
  getPendingUpdateNudgeId?: () => string | null
  getDismissedUpdateNudgeId?: () => string | null
  setPendingUpdateNudgeId?: (id: string | null) => void
  setDismissedUpdateNudgeId?: (id: string | null) => void
  getReleaseChannelOverride?: () => ReleaseChannel | null
  installMode?: UpdateInstallMode
  onBeforeQuitFailure?: PreQuitCleanupFailureMode
}

export class UpdaterSetup extends UpdaterDownloadInstall {
  checkForUpdates(): void {
    this.checkForUpdatesInBackground()
  }

  checkForUpdatesFromMenu(options?: UpdateCheckOptions): void {
    super.checkForUpdatesFromMenu(options)
  }

  downloadUpdate(): void {
    super.downloadUpdate()
  }

  quitAndInstall(): boolean {
    return super.quitAndInstall()
  }

  isQuittingForUpdate(): boolean {
    return super.isQuittingForUpdate()
  }

  getUpdateStatus(): UpdateStatus {
    return super.getUpdateStatus()
  }

  getRemoteServerUpdateSupport(): RemoteServerUpdateSupport {
    return super.getRemoteServerUpdateSupport()
  }

  getRemoteServerUpdaterSnapshot(runtimeId: string): RemoteServerUpdaterSnapshot {
    return super.getRemoteServerUpdaterSnapshot(runtimeId)
  }

  checkForRemoteServerUpdate(
    runtimeId: string,
    options?: UpdateCheckOptions
  ): RemoteServerUpdaterSnapshot {
    return super.checkForRemoteServerUpdate(runtimeId, options)
  }

  downloadRemoteServerUpdate(runtimeId: string): RemoteServerUpdaterSnapshot {
    return super.downloadRemoteServerUpdate(runtimeId)
  }

  installRemoteServerUpdate(runtimeId: string): RemoteServerUpdateInstallResult {
    return super.installRemoteServerUpdate(runtimeId)
  }

  resolveUpdateInstallMode(isServeMode: boolean): UpdateInstallMode {
    return super.resolveUpdateInstallMode(isServeMode)
  }

  async getLinuxPackageInstallInstructions(): Promise<LinuxPackageInstallInstructions> {
    return super.getLinuxPackageInstallInstructions()
  }

  async showLinuxPackage(): Promise<void> {
    return super.showLinuxPackage()
  }

  async listAvailableReleaseBuilds(
    channel: ReleaseChannel,
    options?: ReleaseBuildListOptions
  ): Promise<ReleaseBuild[]> {
    return super.listAvailableReleaseBuilds(channel, options)
  }

  dismissNudge(): void {
    super.dismissNudge()
  }

  dismissAvailableUpdate(): void {
    super.dismissAvailableUpdate()
  }

  setupAutoUpdater(mainWindow: BrowserWindow | null, opts?: UpdaterSetupOptions): void {
    this.mainWindowRef = mainWindow ?? this.mainWindowRef
    this.onBeforeQuitCleanup = opts?.onBeforeQuit ?? null
    this.onBeforeQuitFailure = opts?.onBeforeQuitFailure ?? 'continue'
    this.persistLastUpdateCheckAt = opts?.setLastUpdateCheckAt ?? null
    this._getLastUpdateCheckAt = opts?.getLastUpdateCheckAt ?? null
    this._getPendingUpdateNudgeId = opts?.getPendingUpdateNudgeId ?? null
    this._getDismissedUpdateNudgeId = opts?.getDismissedUpdateNudgeId ?? null
    this._setPendingUpdateNudgeId = opts?.setPendingUpdateNudgeId ?? null
    this._setDismissedUpdateNudgeId = opts?.setDismissedUpdateNudgeId ?? null
    this.getReleaseChannelOverride = opts?.getReleaseChannelOverride ?? null
    this.updateInstallMode = opts?.installMode ?? 'interactive'
    this.lastInstallDeferralVersion = { download: null, install: null }
    const serveHandoffFailure = getServeUpdateHandoffFailure()
    if (serveHandoffFailure) {
      recordUpdaterLifecycle(
        'headless_serve_handoff_failed',
        { reason: serveHandoffFailure },
        { level: 'warn', message: 'Supervised serve update did not complete' }
      )
      this.sendErrorStatus(`The server update did not complete: ${serveHandoffFailure}`, true)
    }
    if (!app.isPackaged) {
      return
    }
    const autoUpdater = this.getAutoUpdater()
    configureMacShipItScheduling()
    autoUpdater.autoDownload = false
    if (this.activeUpdateSource === 'release') {
      autoUpdater.allowDowngrade = false
    }
    autoUpdater.disableDifferentialDownload = true
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.autoRunAppAfterInstall = this.updateInstallMode === 'interactive'
    autoUpdater.logger = createUpdaterDiagnosticLogger() as never
    if (!this.autoUpdaterInitialized) {
      this.autoUpdaterInitialized = true
      autoUpdater.on('login', handleElectronUpdaterProxyLogin)
      registerAutoUpdaterHandlers({
        autoUpdater,
        clearAvailableUpdateContext: this.clearAvailableUpdateContext.bind(this),
        consumeMissingManifestPrereleaseFallbackResult:
          this.consumeMissingManifestPrereleaseFallbackResult.bind(this),
        getMissingManifestPrereleaseFallbackUserInitiated:
          this.getMissingManifestPrereleaseFallbackUserInitiated.bind(this),
        getPublishingWindowLastGoodCheck: this.getPublishingWindowLastGoodCheck.bind(this),
        getActiveUpdateCheckEventAttemptId: this.getActiveUpdateCheckEventAttemptId.bind(this),
        getCurrentStatus: () => this.currentStatus,
        getUpdateMetadata: this.getHiveCloudStatusMetadata.bind(this),
        getKnownReleaseUrl: this.getKnownReleaseUrl.bind(this),
        getPendingInstallVersion: this.getPendingInstallVersion.bind(this),
        getUserInitiatedCheck: () => this.userInitiatedCheck,
        handleQuitAndInstallFailure: this.handleQuitAndInstallFailure.bind(this),
        isQuitAndInstallHandoffActive: this.isQuitAndInstallHandoffActive.bind(this),
        hasInstallableDownloadedVersion: this.hasInstallableDownloadedVersion.bind(this),
        isLocalBuildCheck: () => this.activeUpdateSource === 'local',
        isPinnedBuildCheck: () => this.isPinnedBuildActive,
        isExpectedUpdateOffer: this.isExpectedUpdateOffer.bind(this),
        rejectUnexpectedUpdateOffer: this.rejectUnexpectedUpdateOffer.bind(this),
        acceptDownloadedUpdateCandidate: this.acceptDownloadedUpdateCandidate.bind(this),
        shouldHandleUpdaterErrorEvent: this.shouldHandleUpdaterErrorEvent.bind(this),
        performQuitAndInstall: this.performQuitAndInstall.bind(this),
        commitStagedMacInstall: this.commitStagedMacInstall.bind(this),
        failMacStaging: this.failMacStaging.bind(this),
        isAwaitingMacStaging: this.isAwaitingMacStaging.bind(this),
        isMacStagingDeferredToInstall: this.isMacStagingDeferredToInstall.bind(this),
        startMacStaging: this.startMacStaging.bind(this),
        clearUpdateAvailableEventPending: this.clearUpdateAvailableEventPending.bind(this),
        isActiveUpdateCheckAttempt: this.isActiveUpdateCheckAttempt.bind(this),
        markUpdateCheckEventAttempt: this.markUpdateCheckEventAttempt.bind(this),
        markUpdateAvailableEventPending: this.markUpdateAvailableEventPending.bind(this),
        sendCheckFailureStatus: this.sendCheckFailureStatus.bind(this),
        sendErrorStatus: this.sendErrorStatus.bind(this),
        markMissingManifestPrereleaseFallbackChecking:
          this.markMissingManifestPrereleaseFallbackChecking.bind(this),
        shouldDeferMacQuitForInstall: () => this.updateInstallMode === 'interactive',
        shouldSuppressMissingManifestPrereleaseFallbackEvent:
          this.shouldSuppressMissingManifestPrereleaseFallbackEvent.bind(this),
        suppressMissingManifestPrereleaseFallbackPromiseFailure:
          this.suppressMissingManifestPrereleaseFallbackPromiseFailure.bind(this),
        recordCompletedUpdateCheck: this.recordCompletedUpdateCheck.bind(this),
        restoreReleaseUpdateSource: this.restoreReleaseUpdateSource.bind(this),
        sendStatus: this.sendStatus.bind(this),
        scheduleAutomaticUpdateCheck: this.scheduleAutomaticUpdateCheck.bind(this),
        clearBackgroundCheckLaunchPending: this.clearBackgroundCheckLaunchPending.bind(this),
        setAvailableReleaseUrl: (releaseUrl) => {
          this.availableReleaseUrl = releaseUrl
        },
        setAvailableVersion: (version) => {
          if (version === null) {
            this.clearAvailableUpdateContext()
          } else {
            this.acceptAvailableUpdateCandidate(version)
          }
        },
        setUserInitiatedCheck: (value) => {
          this.userInitiatedCheck = value
        }
      })
    }
    const productUpdateSource =
      !opts?.localOnly && hasConfiguredProductUpdateChannel() ? resolveProductUpdateSource() : null
    const hasValidProviderContract =
      (productUpdateSource?.provider === 'github' && productUpdateSource.github !== null) ||
      (productUpdateSource?.provider === 'hivecloud' && productUpdateSource.github === null)
    const configuredReleaseFeedUrl =
      productUpdateSource && hasValidProviderContract
        ? resolveProductUpdateFeedUrl(productUpdateSource, process.platform, process.arch)
        : null
    if (this.activeUpdateSource === 'release') {
      this.activeReleaseFeedUrl = configuredReleaseFeedUrl
    }
    installProductUpdaterNetworkBoundary(
      productUpdateSource?.github?.repo ?? null,
      this.getProductUpdaterNetworkMode.bind(this),
      (
        autoUpdater as unknown as {
          httpExecutor?: ProductUpdaterHttpExecutor
        }
      ).httpExecutor ?? null,
      () => this.activeLocalBuildFeed?.url ?? null,
      () => {
        const { changelog, nudge } = getProductExternalServiceEndpoints()
        const checkSourceResolver = Object.hasOwn(
          productUpdateSourceModule,
          'resolveProductUpdateCheckSource'
        )
          ? productUpdateSourceModule.resolveProductUpdateCheckSource
          : undefined
        const checkEndpoint =
          typeof checkSourceResolver === 'function'
            ? (checkSourceResolver()?.endpoint ?? null)
            : null
        return [changelog, nudge, checkEndpoint].filter((url): url is string => url !== null)
      },
      () => this.activeReleaseFeedUrl,
      () => this.updateAuthorityEpoch
    )
    if (
      opts?.localOnly ||
      this.releaseUpdaterServicesInitialized ||
      !productUpdateSource ||
      !configuredReleaseFeedUrl
    ) {
      return
    }
    this.releaseUpdaterServicesInitialized = true
    if (this.activeUpdateSource === 'release') {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: configuredReleaseFeedUrl
      })
    }
    void this.checkForUpdateNudge()
    this.scheduleUpdateNudgeCheck()
    const checkDailyOnWake = () => {
      void this.checkForUpdateNudge()
      if (
        this.backgroundCheckLaunchPending ||
        this.currentStatus.state === 'checking' ||
        this.currentStatus.state === 'downloading'
      ) {
        return
      }
      const lastCheck = this._getLastUpdateCheckAt?.() ?? null
      const msSince = lastCheck === null ? Number.POSITIVE_INFINITY : Date.now() - lastCheck
      if (msSince >= AUTO_UPDATE_CHECK_INTERVAL_MS) {
        this.runBackgroundUpdateCheck()
        this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
      }
    }
    powerMonitor.on('resume', checkDailyOnWake)
    app.on('browser-window-focus', checkDailyOnWake)
    const lastUpdateCheckAt = opts?.getLastUpdateCheckAt?.() ?? null
    const msSinceLastCheck =
      lastUpdateCheckAt === null ? Number.POSITIVE_INFINITY : Date.now() - lastUpdateCheckAt
    if (msSinceLastCheck >= AUTO_UPDATE_CHECK_INTERVAL_MS) {
      this.runBackgroundUpdateCheck()
      this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
    } else {
      this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS - msSinceLastCheck)
    }
  }
}
