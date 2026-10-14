import { hasConfiguredProductUpdateChannel } from '../../shared/product-update-policy'
import { ensureAutoUpdaterConfigured } from '../window/attach-main-window-services'
import { configureRemoteServerUpdater } from '../runtime/remote-server-updater'
import {
  getRemoteServerUpdaterSnapshot,
  checkForRemoteServerUpdate,
  downloadRemoteServerUpdate,
  installRemoteServerUpdate
} from '../updater'

export function configureMainProcessRemoteServerUpdater(): void {
  configureRemoteServerUpdater({
    getSnapshot: getRemoteServerUpdaterSnapshot,
    check: (runtimeId, options) => {
      if (options?.localBuild || hasConfiguredProductUpdateChannel()) {
        ensureAutoUpdaterConfigured()
      }
      return checkForRemoteServerUpdate(runtimeId, options)
    },
    download: downloadRemoteServerUpdate,
    install: installRemoteServerUpdate
  })
}
