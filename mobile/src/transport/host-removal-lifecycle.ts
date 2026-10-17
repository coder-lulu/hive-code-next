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

export function removeHostAndCloseClient(
  hostId: string,
  forgetHostClient: (hostId: string) => void
): Promise<void>
export function removeHostAndCloseClient(
  hostId: string,
  forgetHostClient: (hostId: string) => void,
  expectedPairingRevision: string | null,
  afterRemoval?: () => void | Promise<void>
): Promise<boolean>
export async function removeHostAndCloseClient(
  hostId: string,
  forgetHostClient: (hostId: string) => void,
  expectedPairingRevision?: string | null,
  afterRemoval?: () => void | Promise<void>
): Promise<void | boolean> {
  // Why: closing before the metadata commit can strand a still-paired host on
  // storage failure; closing immediately after success prevents socket leaks.
  if (expectedPairingRevision !== undefined) {
    return removeHost(hostId, expectedPairingRevision, () =>
      retireHostConnection(hostId, forgetHostClient, afterRemoval)
    )
  }
  await removeHost(hostId)
  void retireHostConnection(hostId, forgetHostClient).catch(() => undefined)
}

async function retireHostConnection(
  hostId: string,
  forgetHostClient: (hostId: string) => void,
  afterRemoval?: () => void | Promise<void>
): Promise<void> {
  forgetHostClient(hostId)
  forgetHostNotificationSession(hostId)
  forgetHostDescriptor(hostId)
  const results = await Promise.allSettled([
    Promise.resolve().then(() => clearWatermark(hostId)),
    Promise.resolve().then(() => forgetHostUpdateFailures(hostId)),
    Promise.resolve().then(() => deleteHostPageCache(hostId)),
    Promise.resolve().then(() => afterRemoval?.())
  ])
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }
}
