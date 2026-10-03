import { createNotificationStreamFilter } from './notification-stream-policy'
import { defineStreamingMethod, defineMethod } from '../core'
import {
  NotificationTestPushParams,
  NotificationGetMissedSinceParams,
  NotificationUnsubscribeParams,
  NotificationsSubscribeParams
} from '../../../../shared/rpc-contract/notifications-params'

// Why: monotonically increasing per-process counter eliminates the
// Date.now() collision that could fire when two near-simultaneous
// notifications.subscribe calls landed on the same millisecond.
let notificationsSubscriptionSeq = 0

// Legacy paired-socket callers retain filtered live alerts and replay.
export const NOTIFICATION_METHODS = [
  defineMethod({
    name: 'notifications.testPush',
    params: NotificationTestPushParams,
    handler: async (_params, { runtime }) => runtime.testMobileNotificationRemotePush()
  }),
  defineStreamingMethod({
    name: 'notifications.subscribe',
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
    params: NotificationUnsubscribeParams,
    handler: async (params, { runtime }) => {
      runtime.cleanupSubscription(params.subscriptionId)
      return { unsubscribed: true }
    }
  }),
  defineMethod({
    name: 'notifications.getMissedSince',
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
