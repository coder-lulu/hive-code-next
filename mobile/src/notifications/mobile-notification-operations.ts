import { z } from 'zod'
import { defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

const sequence = {
  notificationSeq: z.number().finite().optional(),
  notificationEpoch: z.string().optional()
}
const notificationEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('notification'),
    source: z.enum(['agent-task-complete', 'terminal-bell', 'test', 'plugin']).optional(),
    title: z.string(),
    body: z.string(),
    worktreeId: z.string().optional(),
    notificationId: z.string().optional(),
    deliveryId: z.uuidv4().optional(),
    accountId: z.uuid().optional(),
    ...sequence
  }),
  z.object({ type: z.literal('dismiss'), notificationId: z.string(), ...sequence })
])
const streamEvent = z.union([
  notificationEvent,
  z.object({ type: z.literal('ready'), subscriptionId: z.string(), epoch: z.string().optional() }),
  z.object({ type: z.literal('end') })
])

export function parseNotificationStreamEvent(value: unknown) {
  const parsed = streamEvent.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const missedNotifications = defineRpcOperation({
  name: 'notifications.catchUp',
  method: 'notifications.getMissedSince',
  acceptance: 'object-result-or-null',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'missed',
    z.object({
      notifications: z.array(notificationEvent).optional(),
      epoch: z.string().optional()
    })
  )
})
export const unsubscribeNotifications = defineRpcOperation({
  name: 'notifications.unsubscribe',
  method: 'notifications.unsubscribe',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'acknowledged',
    z.unknown().transform(() => undefined)
  )
})
