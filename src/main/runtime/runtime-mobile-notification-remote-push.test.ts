import { describe, expect, it, vi } from 'vitest'
import { RuntimeMobileNotificationController } from './runtime-mobile-notification-controller'

describe('RuntimeMobileNotificationController remote push', () => {
  it('records and fans out before starting the non-blocking HiveCloud sink', async () => {
    const order: string[] = []
    let liveDeliveryId: string | undefined
    let liveAccountId: string | undefined
    const accountId = '33333333-3333-4333-8333-333333333333'
    const send = vi.fn(async () => {
      order.push('push')
      return { accepted: true as const }
    })
    const controller = new RuntimeMobileNotificationController()
    controller.setRemotePushSink({
      prepare: () => ({ accountId, send })
    })
    controller.onDispatched((event) => {
      order.push('live')
      if (event.type === 'notification') {
        liveDeliveryId = event.deliveryId
        liveAccountId = event.accountId
      }
    })

    controller.dispatch({
      type: 'notification',
      source: 'terminal-bell',
      title: 'terminal',
      body: 'bell',
      notificationId: 'bell:1',
      accountId: '44444444-4444-4444-8444-444444444444'
    })

    expect(order).toEqual(['live'])
    expect(controller.getMissedSince(0)).toHaveLength(1)
    await vi.waitFor(() => expect(order).toEqual(['live', 'push']))
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: 'bell:1',
        notificationSeq: 1,
        deliveryId: liveDeliveryId,
        accountId
      })
    )
    expect(liveAccountId).toBe(accountId)
    expect(liveDeliveryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('does not fan out a caller-supplied account without a prepared cloud authorization', () => {
    const controller = new RuntimeMobileNotificationController()
    let dispatchedAccountId: string | undefined
    controller.onDispatched((event) => {
      if (event.type === 'notification') {
        dispatchedAccountId = event.accountId
      }
    })

    controller.dispatch({
      type: 'notification',
      source: 'test',
      title: 'test',
      body: 'test',
      accountId: '44444444-4444-4444-8444-444444444444'
    })

    expect(dispatchedAccountId).toBeUndefined()
  })

  it('keeps local delivery available when preparing HiveCloud push throws', async () => {
    const controller = new RuntimeMobileNotificationController()
    const listener = vi.fn()
    controller.onDispatched(listener)
    controller.setRemotePushSink({
      prepare: () => {
        throw new Error('authorization storage unavailable')
      }
    })

    controller.dispatch({
      type: 'notification',
      source: 'test',
      title: 'test',
      body: 'test'
    })

    expect(listener).toHaveBeenCalledOnce()
    expect(controller.getMissedSince(0)).toHaveLength(1)
    await expect(controller.testRemotePush()).resolves.toEqual({
      accepted: false,
      reason: 'unavailable'
    })
  })

  it('returns the real sink outcome for testPush and explicit unavailable without a sink', async () => {
    const controller = new RuntimeMobileNotificationController()
    await expect(controller.testRemotePush()).resolves.toEqual({
      accepted: false,
      reason: 'unavailable'
    })
    controller.setRemotePushSink({
      prepare: () => ({
        accountId: '33333333-3333-4333-8333-333333333333',
        send: vi.fn(async () => ({ accepted: false as const, reason: 'not_registered' as const }))
      })
    })
    await expect(controller.testRemotePush()).resolves.toEqual({
      accepted: false,
      reason: 'not_registered'
    })
  })
})
