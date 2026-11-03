import { autoUpdater as nativeUpdater } from 'electron'
import { failServeUpdateHandoff } from '../serve-update-handoff'
import { runWithLaunchPath } from '../startup/hydrate-shell-path'
import { recordUpdaterLifecycle } from '../updater-lifecycle-diagnostics'
import {
  getMacDownloadGeneration,
  hasMacInstallAuthority,
  hasMacStagingAuthority,
  isWaitingForMacInstallerReadiness
} from '../updater-mac-install'
import { prepareThisProcessShipItStaging } from './shipit-leftover-recovery'
import { releaseSessionsForInstaller } from './updater-installer-session-release'
import { UpdaterMacInstallPreflight } from './updater-mac-install-preflight'

export abstract class UpdaterMacStaging extends UpdaterMacInstallPreflight {
  // Supervised serve disables autoInstallOnAppQuit; MacUpdater only stages inside quitAndInstall, so waiting first deadlocks.
  protected isMacStagingDeferredToInstall(): boolean {
    return process.platform === 'darwin' && this.updateInstallMode === 'supervised-headless-serve'
  }

  protected isAwaitingMacStaging(): boolean {
    return (
      this.isMacStagingDeferredToInstall() &&
      this.quitAndInstallInProgress &&
      this.macNativeStagingInProgress &&
      !this.updateInstallCommitted
    )
  }

  /** Squirrel staged the bundle that quitAndInstall asked for; the installer now owns the swap. */
  protected commitStagedMacInstall(): void {
    if (
      !this.isAwaitingMacStaging() ||
      !hasMacInstallAuthority() ||
      !this.hasInstallableDownloadedVersion()
    ) {
      return
    }
    this.macNativeStagingInProgress = false
    this.clearMacDeferredStagingTimer()
    this.commitInFlightInstall()
    recordUpdaterLifecycle('macos_deferred_staging_committed', {
      version: this.getPendingInstallVersion() || null
    })
    try {
      releaseSessionsForInstaller()
    } catch (error) {
      recordUpdaterLifecycle(
        'post_commit_cleanup_failed',
        { errorType: error instanceof Error ? error.name : typeof error },
        {
          level: 'warn',
          message: 'Update install cleanup failed after commit; install already applied'
        }
      )
    }
    this.quitAndInstallNativeInvoked = true
    runWithLaunchPath(() => this.getAutoUpdater().quitAndInstall(true, false))
  }

  // Only Squirrel errors end staging; unrelated background-check errors must leave it active.
  protected failMacStaging(error: unknown): void {
    if (!this.macNativeStagingInProgress) {
      return
    }
    if (this.quitAndInstallInProgress) {
      failServeUpdateHandoff('The native updater rejected staging.')
    }
    this.resetQuitForUpdateState()
    this.sendInstallFailureStatus({
      state: 'error',
      message: this.withInstallFailureCause(this.getPreCommitInstallFailureMessage(), error)
    })
  }

  protected startMacStaging(): void {
    if (
      this.macNativeStagingInProgress ||
      !this.hasInstallableDownloadedVersion() ||
      !hasMacStagingAuthority()
    ) {
      return
    }
    this.macNativeStagingInProgress = true
    const generation = getMacDownloadGeneration()
    void Promise.resolve(prepareThisProcessShipItStaging())
      .then(() => {
        if (
          !this.macNativeStagingInProgress ||
          generation !== getMacDownloadGeneration() ||
          !this.hasInstallableDownloadedVersion() ||
          !hasMacStagingAuthority()
        ) {
          return
        }
        nativeUpdater.checkForUpdates()
      })
      .catch(this.failMacStaging.bind(this))
  }

  protected hasInstallablePendingUpdate(): boolean {
    if (!this.hasInstallableDownloadedVersion()) {
      return false
    }
    if (isWaitingForMacInstallerReadiness(this.currentStatus, true)) {
      return true
    }
    return (
      (this.currentStatus.state === 'downloaded' ||
        this.getActiveLinuxPackageRecovery() !== null) &&
      (hasMacInstallAuthority() ||
        (this.isMacStagingDeferredToInstall() && hasMacStagingAuthority()))
    )
  }
  protected abstract commitInFlightInstall(): void
  protected abstract handleQuitAndInstallFailure(error?: unknown): boolean
}
