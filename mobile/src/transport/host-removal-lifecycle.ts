import {
  deleteHostPageCache,
  forgetHostUpdateFailures
} from '../mobile-web-shell/removed-host-shell-cache'
import {
  clearWatermark,
  forgetHostNotificationSession
} from '../notifications/notification-reconnect-catchup'
import { forgetHostDescriptor } from './host-descriptor-store'
import { removeHost } from './host-store'

export async function removeHostAndCloseClient(
  hostId: string,
  forgetHostClient: (hostId: string) => void
): Promise<void> {
  // Why: closing before the metadata commit can strand a still-paired host on
  // storage failure; closing immediately after success prevents socket leaks.
  await removeHost(hostId)
  forgetHostClient(hostId)
  forgetHostNotificationSession(hostId)
  void clearWatermark(hostId)
  forgetHostDescriptor(hostId)
  void forgetHostUpdateFailures(hostId).catch(() => undefined)
  void deleteHostPageCache(hostId).catch(() => undefined)
}
