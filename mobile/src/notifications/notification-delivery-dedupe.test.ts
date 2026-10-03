import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireNotificationDelivery,
  notificationDeliveryIdFromData,
  resetNotificationDeliveryDedupeForTests
} from './notification-delivery-dedupe'

const DELIVERY_ID = '22222222-2222-4222-8222-222222222222'

afterEach(() => resetNotificationDeliveryDedupeForTests())

describe('notification cross-channel delivery dedupe', () => {
  it('shows only the first successful contender', async () => {
    const live = await acquireNotificationDelivery(DELIVERY_ID)
    expect(live).not.toBeNull()

    const remoteResult = acquireNotificationDelivery(DELIVERY_ID)
    live!.commit()

    await expect(remoteResult).resolves.toBeNull()
    await expect(acquireNotificationDelivery(DELIVERY_ID)).resolves.toBeNull()
  })

  it('allows the other channel to take over after presentation fails', async () => {
    const live = await acquireNotificationDelivery(DELIVERY_ID)
    const remoteResult = acquireNotificationDelivery(DELIVERY_ID)
    live!.release()

    const remote = await remoteResult
    expect(remote).not.toBeNull()
    remote!.commit()
  })

  it('extracts only canonical version-four delivery ids from provider data', () => {
    expect(notificationDeliveryIdFromData({ deliveryId: DELIVERY_ID })).toBe(DELIVERY_ID)
    expect(notificationDeliveryIdFromData({ deliveryId: 'not-a-uuid' })).toBeNull()
    expect(notificationDeliveryIdFromData(null)).toBeNull()
  })
})
