import { app } from 'electron'
import { resolveProductUpdateSource } from '../../shared/product-update-source'
import type { UpdateCheckOptions, UpdateStatus } from '../../shared/update-status-types'
import { isPrereleaseVersion } from '../updater-fallback'
import { UpdaterStatus } from './updater-status'
import type { UpdateCheckVariant } from './updater-types'

export abstract class UpdaterCheckOptions extends UpdaterStatus {
  protected getOptionsForUpdateCheckVariant(variant: UpdateCheckVariant): UpdateCheckOptions {
    switch (variant) {
      case 'perf':
        return { includePrerelease: true, includePerfPrerelease: true }
      case 'prerelease':
        return { includePrerelease: true }
      case 'default':
        return { includePrerelease: false }
    }
  }

  protected getUpdateCheckVariant(options?: UpdateCheckOptions): UpdateCheckVariant {
    if (options?.includePerfPrerelease) {
      return 'perf'
    }
    if (options?.includePrerelease) {
      return 'prerelease'
    }
    const override = this.getReleaseChannelOverride?.()
    if (override === 'stable' || override === 'rc') {
      return override === 'rc' ? 'prerelease' : 'default'
    }
    const configuredChannel = resolveProductUpdateSource()?.channel
    if (
      configuredChannel === 'stable' ||
      configuredChannel === 'beta' ||
      configuredChannel === 'rc'
    ) {
      return configuredChannel === 'stable' ? 'default' : 'prerelease'
    }
    return isPrereleaseVersion(app.getVersion()) ? 'prerelease' : 'default'
  }

  protected isUpdateCheckResultState(state: UpdateStatus['state']): boolean {
    return (
      state === 'idle' ||
      state === 'disabled' ||
      state === 'not-available' ||
      state === 'available' ||
      state === 'error' ||
      state === 'downloading' ||
      state === 'downloaded'
    )
  }
}
