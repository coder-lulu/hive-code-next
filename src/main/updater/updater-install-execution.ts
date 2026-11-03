import { APP_DISPLAY_NAME, applyProductBranding } from '../../shared/brand'
import { getLinuxRootPackageType } from '../linux-update-package-type'
import { getMacUpdateRunningInstances } from '../macos-update-running-instances'
import { withUpdaterSpan } from '../observability/instrumentation'
import { failServeUpdateHandoff, requestServeUpdateHandoff } from '../serve-update-handoff'
import { runWithLaunchPath } from '../startup/hydrate-shell-path'
import { armUpdateInstallExitWatchdog } from '../update-install-exit-watchdog'
import { recordUpdaterLifecycle } from '../updater-lifecycle-diagnostics'
import {
  hasMacStagingAuthority,
  isMacInstallerReady,
  markMacQuitAndInstallInFlight,
  setMacInstallPreflightInProgress
} from '../updater-mac-install'
import { commitServeSupervisorPark } from './serve-supervisor-install-park'
import { prepareThisProcessShipItStaging } from './shipit-leftover-recovery'
import { releaseSessionsForInstaller } from './updater-installer-session-release'
import { UpdaterMacStaging } from './updater-mac-staging'
import { MAC_DEFERRED_STAGING_TIMEOUT_MS } from './updater-state'
import { wslMoveInstallHold } from './updater-wsl-move-install-hold'

export abstract class UpdaterInstallExecution extends UpdaterMacStaging {
  protected async performQuitAndInstall(): Promise<void> {
    if (this.quitAndInstallInProgress) {
      recordUpdaterLifecycle('quit_and_install_ignored', { reason: 'already-in-progress' })
      return
    }
    if (this.pendingQuitAndInstallTimer) {
      clearTimeout(this.pendingQuitAndInstallTimer)
      this.pendingQuitAndInstallTimer = null
    }
    if (!this.hasInstallablePendingUpdate()) {
      recordUpdaterLifecycle('quit_and_install_ignored', { reason: 'no-downloaded-update' })
      this.sendToMainWindow('updater:quitAndInstallAborted')
      return
    }
    if (this.routeLinuxRootPackageToManualInstall()) {
      return
    }
    const pendingVersion = this.getPendingInstallVersion()
    if (this.deferHeadlessServeInstall('install', pendingVersion)) {
      return
    }
    const moveHold = wslMoveInstallHold()
    if (moveHold) {
      recordUpdaterLifecycle(moveHold.lifecycleEvent)
      this.sendToMainWindow('updater:quitAndInstallAborted')
      this.sendInstallFailureStatus({
        state: 'error',
        message: moveHold.message,
        version: pendingVersion,
        retryAction: 'install'
      })
      return
    }
    this.finishActiveUpdateCheckAttempt()
    this.clearBackgroundCheckLaunchPending()
    this.quitAndInstallInProgress = true
    this.quittingForUpdate = true
    try {
      this.sendStatus(
        { state: 'downloaded', version: pendingVersion, installing: true },
        { force: true }
      )
      if (!(await this.preflightMacInstall(pendingVersion))) {
        return
      }
      markMacQuitAndInstallInFlight()
      await withUpdaterSpan({ stage: 'install' }, async (span) => {
        span.setAttribute('updater.version', pendingVersion || 'unknown')
        span.setAttribute('updater.platform', process.platform)
        span.setAttribute(
          'updater.macosInstallerReady',
          process.platform === 'darwin' ? isMacInstallerReady() : true
        )
        recordUpdaterLifecycle('quit_and_install_started', {
          version: pendingVersion || null,
          macInstallerReady: process.platform === 'darwin' ? isMacInstallerReady() : true
        })
        span.addEvent('pre_quit_cleanup_start')
        await this.runBeforeUpdateQuitCleanup()
        span.addEvent('pre_quit_cleanup_done')
        if (
          this.updateInstallMode === 'supervised-headless-serve' &&
          !requestServeUpdateHandoff(pendingVersion)
        ) {
          recordUpdaterLifecycle(
            'headless_serve_handoff_failed',
            { version: pendingVersion || null },
            {
              level: 'warn',
              message: 'Could not persist supervised serve update handoff'
            }
          )
          this.sendErrorStatus(
            applyProductBranding(
              'Could not prepare the supervised server restart. Orca remains running.'
            ),
            true
          )
          this.resetQuitForUpdateState()
          span.fail('Could not persist the supervised serve update handoff')
          return
        }
        await commitServeSupervisorPark(() => getMacUpdateRunningInstances())
        if (
          this.isMacStagingDeferredToInstall() &&
          (await prepareThisProcessShipItStaging()) !== true
        ) {
          throw new Error('macOS staging preparation was not approved')
        }
        if (
          !this.quitAndInstallInProgress ||
          !this.hasInstallableDownloadedVersion() ||
          !hasMacStagingAuthority()
        ) {
          throw new Error('Update install authority changed during preparation')
        }
        if (process.platform === 'darwin' && !isMacInstallerReady()) {
          setMacInstallPreflightInProgress(false)
          this.startMacStaging()
          if (this.isAwaitingMacStaging()) {
            this.macDeferredStagingTimer = setTimeout(() => {
              this.macDeferredStagingTimer = null
              this.sendInstallFailureStatus({
                state: 'error',
                message: `macOS has not finished preparing the update. ${APP_DISPLAY_NAME} keeps serving and installs it once ready; restart the service if it never does.`,
                ...(pendingVersion ? { version: pendingVersion } : {}),
                retryable: false
              })
            }, MAC_DEFERRED_STAGING_TIMEOUT_MS)
          }
          return
        }
        recordUpdaterLifecycle('quit_and_install_invoking_native', {
          version: pendingVersion || null
        })
        if (!this.quitAndInstallInProgress) {
          return
        }
        setMacInstallPreflightInProgress(false)
        this.quitAndInstallNativeInvoked = true
        const supervisorOwnsRelaunch = this.updateInstallMode === 'supervised-headless-serve'
        runWithLaunchPath(() =>
          this.getAutoUpdater().quitAndInstall(supervisorOwnsRelaunch, !supervisorOwnsRelaunch)
        )
        span.addEvent('native_quit_and_install_invoked')
        if (!this.quitAndInstallInProgress) {
          span.fail(
            this.currentStatus.state === 'error'
              ? this.currentStatus.message
              : 'quitAndInstall returned without invoking the installer'
          )
          return
        }
        if (getLinuxRootPackageType() !== null) {
          this.updateInstallCommitted = true
          armUpdateInstallExitWatchdog()
        }
        const windowCount = releaseSessionsForInstaller()
        span.addEvent('local_pty_kill_all')
        span.addEvent('window_close_listeners_removed', { windowCount })
        if (
          !this.updateInstallCommitted &&
          (process.platform !== 'darwin' || isMacInstallerReady())
        ) {
          this.commitInFlightInstall()
        }
      })
    } catch (error) {
      if (this.updateInstallCommitted) {
        recordUpdaterLifecycle(
          'post_commit_cleanup_failed',
          { errorType: error instanceof Error ? error.name : typeof error },
          {
            level: 'warn',
            message: 'Update install cleanup failed after commit; install already applied'
          }
        )
        return
      }
      const quitAndInstallNativeInvokedBeforeReset = this.quitAndInstallNativeInvoked
      failServeUpdateHandoff('Could not invoke the native updater.')
      this.resetQuitForUpdateState()
      recordUpdaterLifecycle(
        'quit_and_install_failed',
        { errorType: error instanceof Error ? error.name : typeof error },
        {
          level: 'warn',
          message: 'Could not start update install'
        }
      )
      this.sendInstallFailureStatus({
        state: 'error',
        message: quitAndInstallNativeInvokedBeforeReset
          ? this.withInstallFailureCause(this.getPreCommitInstallFailureMessage(), error)
          : applyProductBranding(
              'Could not restart to install the update. Quit and reopen Orca, then try again.'
            )
      })
    }
  }

  protected commitInFlightInstall(): void {
    if (!this.quitAndInstallInProgress || this.updateInstallCommitted) {
      return
    }
    this.updateInstallCommitted = true
    // After commit, wedged shutdown strands the installer waiting for this process (#4438); arm an exit watchdog.
    armUpdateInstallExitWatchdog()
  }

  // Recover only between native invoke and commit; clearing quittingForUpdate afterward could reopen the old bundle mid-install.
  protected handleQuitAndInstallFailure(error?: unknown): boolean {
    if (
      !this.quitAndInstallInProgress ||
      !this.quitAndInstallNativeInvoked ||
      this.updateInstallCommitted
    ) {
      return false
    }
    failServeUpdateHandoff('The native updater rejected the install request.')
    this.resetQuitForUpdateState()
    recordUpdaterLifecycle(
      'quit_and_install_failed_via_event',
      { errorType: error instanceof Error ? error.name : typeof error },
      {
        level: 'warn',
        message: 'Update install could not start; recovered app state'
      }
    )
    this.sendInstallFailureStatus({
      state: 'error',
      message: this.withInstallFailureCause(this.getPreCommitInstallFailureMessage(), error)
    })
    return true
  }
}
