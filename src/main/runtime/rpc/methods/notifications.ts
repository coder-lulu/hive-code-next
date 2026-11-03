import { createNotificationStreamFilter } from './notification-stream-policy'
import { defineStreamingMethod, defineMethod, type RpcContext } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  NotificationTestPushParams,
  NotificationReportDesktopPresenceParams,
  NotificationGetMissedSinceParams,
  NotificationUnsubscribeParams,
  NotificationsSubscribeParams
} from '../../../../shared/rpc-contract/notifications-params'

// Why: monotonically increasing per-process counter eliminates the
// Date.now() collision that could fire when two near-simultaneous
// notifications.subscribe calls landed on the same millisecond.
let notificationsSubscriptionSeq = 0

type DesktopPresenceReportContext = Pick<RpcContext, 'clientKind' | 'connectionId' | 'signal'> & {
  runtime: Pick<OrcaRuntimeService, 'reportDesktopClientPresence' | 'registerSubscriptionCleanup'>
}

/** Only a paired desktop's own socket speaks for a desktop; the report lives as long as it. */
export function reportDesktopPresence(
  params: { away: boolean },
  { runtime, clientKind, connectionId, signal }: DesktopPresenceReportContext
): { recorded: boolean } {
  // A closed socket already ran its cleanups, so a late report would never be forgotten.
  if (clientKind !== 'runtime' || !connectionId || signal?.aborted) {
    return { recorded: false }
  }
  runtime.reportDesktopClientPresence(connectionId, params.away, (forget) =>
    runtime.registerSubscriptionCleanup(`desktop-presence-${connectionId}`, forget, connectionId)
  )
  return { recorded: true }
}

// Current authenticated callers receive filtered live alerts and replay.
export const NOTIFICATION_METHODS = [
  defineMethod({
    name: 'notifications.reportDesktopPresence',
    permission: 'workspace',
    params: NotificationReportDesktopPresenceParams,
    handler: async (params, context) => reportDesktopPresence(params, context)
  }),
  defineMethod({
    name: 'notifications.testPush',
    permission: 'workspace',
    params: NotificationTestPushParams,
    handler: async (_params, { runtime }) => runtime.testMobileNotificationRemotePush()
  }),
  defineStreamingMethod({
    name: 'notifications.subscribe',
    permission: 'workspace',
    params: NotificationsSubscribeParams,
    handler: async (params, { runtime, connectionId }, emit) => {
      const shouldEmit = createNotificationStreamFilter(params?.includeDesktopSuppressed)
      await new Promise<void>((resolve) => {
        const unsubscribe = runtime.onNotificationDispatched((event) => {
          if (shouldEmit(event)) {
            emit(event)
          }
        })

        // Why: scope by per-ws connectionId + per-process counter so
        // concurrent subscribes never collide on the cleanup map.
        const seq = ++notificationsSubscriptionSeq
        const subscriptionId = `notifications-${connectionId ?? 'inproc'}-${seq}`
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            unsubscribe()
            emit({ type: 'end' })
            resolve()
          },
          connectionId
        )

        // Why: the epoch rides the ready frame so a reconnecting client learns the
        // counter lifetime BEFORE it sends its watermark to getMissedSince (#8591).
        emit({ type: 'ready', subscriptionId, epoch: runtime.getMobileNotificationEpoch() })
      })
    }
  }),
  defineMethod({
    name: 'notifications.unsubscribe',
    permission: 'workspace',
    params: NotificationUnsubscribeParams,
    handler: async (params, { runtime }) => {
      runtime.cleanupSubscription(params.subscriptionId)
      return { unsubscribed: true }
    }
  }),
  defineMethod({
    name: 'notifications.getMissedSince',
    permission: 'workspace',
    params: NotificationGetMissedSinceParams,
    // Why: returns only notifications with seq > lastSeenSeq. The runtime owns
    // the monotonic seq, so this is the single source of truth for what the
    // client missed while its socket was reaped.
    handler: async (params, { runtime }) => {
      const missed = runtime.getMissedNotificationsSince(params.lastSeenSeq, params.epoch)
      return {
        notifications: missed.filter(
          createNotificationStreamFilter(params.includeDesktopSuppressed)
        ),
        epoch: runtime.getMobileNotificationEpoch()
      }
    }
  })
]
