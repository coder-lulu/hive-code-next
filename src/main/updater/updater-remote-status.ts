import { app } from 'electron'
import { hasConfiguredProductUpdateChannel } from '../../shared/product-update-policy'
import type {
  RemoteServerUpdateInstallResult,
  RemoteServerUpdaterSnapshot,
  RemoteServerUpdateSupport
} from '../../shared/remote-server-update'
import type { UpdateCheckOptions, UpdateStatus } from '../../shared/update-status-types'
import { requiresManualLinuxRootPackageInstall } from '../linux-root-package-install-policy'
import { getLinuxPackageType, getLinuxRootPackageType } from '../linux-update-package-type'
import { hasServeUpdateSupervisor } from '../serve-update-handoff'
import { UpdaterNudge } from './updater-nudge'
import type { UpdateInstallMode } from './updater-state'

export abstract class UpdaterRemoteStatus extends UpdaterNudge {
  protected getUpdateStatus(): UpdateStatus {
    if (
      !hasConfiguredProductUpdateChannel() &&
      (this.currentStatus.state === 'idle' || this.currentStatus.state === 'not-available')
    ) {
      return { state: 'disabled', reason: 'not-configured' }
    }
    return this.currentStatus
  }

  protected getRemoteServerUpdateSupport(): RemoteServerUpdateSupport {
    if (!app.isPackaged) {
      return {
        installMode: this.updateInstallMode,
        automatic: false,
        reason: 'unpackaged-build'
      }
    }
    if (
      !this.autoUpdaterInitialized ||
      !this.releaseUpdaterServicesInitialized ||
      !hasConfiguredProductUpdateChannel()
    ) {
      return {
        installMode: this.updateInstallMode,
        automatic: false,
        reason: 'updater-unavailable'
      }
    }
    if (this.updateInstallMode === 'unsupported-headless-serve') {
      return {
        installMode: this.updateInstallMode,
        automatic: false,
        reason: 'manual-service-update-required'
      }
    }
    if (
      getLinuxPackageType() === 'unusable' ||
      (getLinuxRootPackageType() && requiresManualLinuxRootPackageInstall())
    ) {
      return {
        installMode: this.updateInstallMode,
        automatic: false,
        reason: 'manual-service-update-required'
      }
    }
    return { installMode: this.updateInstallMode, automatic: true, reason: 'available' }
  }

  protected getRemoteServerUpdaterSnapshot(runtimeId: string): RemoteServerUpdaterSnapshot {
    return {
      appVersion: app.getVersion(),
      runtimeId,
      support: this.getRemoteServerUpdateSupport(),
      status: this.getUpdateStatus()
    }
  }

  protected assertRemoteServerUpdateAvailable(): void {
    if (!this.getRemoteServerUpdateSupport().automatic) {
      throw new Error('remote_update_manual_required')
    }
  }

  protected checkForRemoteServerUpdate(
    runtimeId: string,
    options?: UpdateCheckOptions
  ): RemoteServerUpdaterSnapshot {
    if (options?.localBuild) {
      if (!this.autoUpdaterInitialized) {
        throw new Error('remote_update_manual_required')
      }
      this.checkForUpdatesFromMenu(options)
      return this.getRemoteServerUpdaterSnapshot(runtimeId)
    }
    if (!this.releaseUpdaterServicesInitialized || !hasConfiguredProductUpdateChannel()) {
      this.reportReleaseUpdatesDisabled()
      return this.getRemoteServerUpdaterSnapshot(runtimeId)
    }
    this.assertRemoteServerUpdateAvailable()
    this.checkForUpdatesFromMenu(options)
    return this.getRemoteServerUpdaterSnapshot(runtimeId)
  }

  protected downloadRemoteServerUpdate(runtimeId: string): RemoteServerUpdaterSnapshot {
    this.assertRemoteServerUpdateAvailable()
    if (this.currentStatus.state !== 'available') {
      throw new Error('remote_update_not_available')
    }
    this.downloadUpdate()
    return this.getRemoteServerUpdaterSnapshot(runtimeId)
  }

  protected installRemoteServerUpdate(runtimeId: string): RemoteServerUpdateInstallResult {
    this.assertRemoteServerUpdateAvailable()
    if (this.currentStatus.state !== 'downloaded') {
      throw new Error('remote_update_not_downloaded')
    }
    const targetVersion = this.currentStatus.version
    const result: RemoteServerUpdateInstallResult = {
      accepted: true,
      fromVersion: app.getVersion(),
      targetVersion,
      runtimeId
    }
    this.quitAndInstall()
    return result
  }

  protected resolveUpdateInstallMode(isServeMode: boolean): UpdateInstallMode {
    if (!isServeMode) {
      return 'interactive'
    }
    return hasServeUpdateSupervisor() ? 'supervised-headless-serve' : 'unsupported-headless-serve'
  }

  protected abstract downloadUpdate(): void
  protected abstract quitAndInstall(): void
}
