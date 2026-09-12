import { describe, expect, it } from 'vitest'
import { parseNotificationStreamEvent, missedNotifications } from './mobile-notification-operations'

describe('notification operation readers', () => {
  it('preserves legacy source absence and rejects invalid notification fields', () => {
    const legacy = { type: 'notification', title: 'Done', body: 'Finished', notificationSeq: 6 }
    expect(parseNotificationStreamEvent(legacy)).toEqual(legacy)
    expect(parseNotificationStreamEvent({ ...legacy, source: 7 })).toBeNull()
    expect(parseNotificationStreamEvent({ ...legacy, title: null })).toBeNull()
    expect(parseNotificationStreamEvent({ ...legacy, notificationSeq: Number.NaN })).toBeNull()
    expect(parseNotificationStreamEvent(null)).toBeNull()
  })

  it('decodes readiness and rejects an incompatible missed batch without advancing its watermark', () => {
    expect(parseNotificationStreamEvent({ type: 'ready', subscriptionId: 'sub-1' })).toEqual({
      type: 'ready',
      subscriptionId: 'sub-1'
    })
    expect(parseNotificationStreamEvent({ type: 'ready', subscriptionId: 7 })).toBeNull()
    expect(
      missedNotifications.read({
        notifications: [{ type: 'dismiss', notificationId: 'agent:one' }]
      }).compatible
    ).toBe(true)
    expect(
      missedNotifications.read({ notifications: [{ type: 'dismiss', notificationId: 7 }] })
        .compatible
    ).toBe(false)
  })
})
