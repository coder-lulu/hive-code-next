import { describe, expect, it } from 'vitest'
import { parseNotificationStreamEvent, missedNotifications } from './mobile-notification-operations'

describe('notification operation readers', () => {
  it('preserves legacy source absence and rejects invalid notification fields', () => {
    const legacy = { type: 'notification', title: 'Done', body: 'Finished', notificationSeq: 6 }
    expect(parseNotificationStreamEvent(legacy)).toEqual(legacy)
    expect(parseNotificationStreamEvent({ ...legacy, source: 7 })).toBeNull()
    expect(parseNotificationStreamEvent({ ...legacy, title: null })).toBeNull()
    expect(parseNotificationStreamEvent({ ...legacy, notificationSeq: Number.NaN })).toBeNull()
    expect(
      parseNotificationStreamEvent({
        ...legacy,
        deliveryId: '22222222-2222-4222-8222-222222222222'
      })
    ).toMatchObject({ deliveryId: '22222222-2222-4222-8222-222222222222' })
    expect(parseNotificationStreamEvent({ ...legacy, deliveryId: 'not-a-uuid' })).toBeNull()
    expect(
      parseNotificationStreamEvent({
        ...legacy,
        source: 'plugin',
        accountId: '33333333-3333-4333-8333-333333333333'
      })
    ).toMatchObject({
      source: 'plugin',
      accountId: '33333333-3333-4333-8333-333333333333'
    })
    expect(parseNotificationStreamEvent({ ...legacy, accountId: 'not-a-uuid' })).toBeNull()
    expect(
      parseNotificationStreamEvent({
        ...legacy,
        deliveryId: '22222222-2222-7222-8222-222222222222'
      })
    ).toBeNull()
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
