import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireNotificationDelivery,
  resetNotificationDeliveryDedupeForTests
} from './notification-delivery-dedupe'
import { recordHiveMobilePushPresentationAck } from './hive-mobile-push-presentation-ack'
import { handleForegroundNotificationPresentation } from './native-push-notification-presentation'

vi.mock('./hive-mobile-push-presentation-ack', () => ({
  recordHiveMobilePushPresentationAck: vi.fn()
}))

const DELIVERY_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_ID = 'account-id'

describe('native push foreground presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetNotificationDeliveryDedupeForTests()
    vi.mocked(recordHiveMobilePushPresentationAck).mockResolvedValue(undefined)
  })

  afterEach(() => vi.useRealTimers())

  it('commits the delivery and records an acknowledgement before showing the native push', async () => {
    await expect(
      handleForegroundNotificationPresentation({
        request: {
          content: { data: { deliveryId: DELIVERY_ID, accountId: ACCOUNT_ID } },
          trigger: { type: 'push' }
        }
      })
    ).resolves.toMatchObject({ shouldShowBanner: true, shouldShowList: true })

    expect(recordHiveMobilePushPresentationAck).toHaveBeenCalledWith(DELIVERY_ID, ACCOUNT_ID)
    await expect(acquireNotificationDelivery(DELIVERY_ID)).resolves.toBeNull()
  })

  it('waits for acknowledgement persistence before resolving the foreground handler', async () => {
    let finishPersistence!: () => void
    const persistence = new Promise<void>((resolve) => {
      finishPersistence = resolve
    })
    vi.mocked(recordHiveMobilePushPresentationAck).mockReturnValueOnce(persistence)

    const presentation = handleForegroundNotificationPresentation({
      request: {
        content: { data: { deliveryId: DELIVERY_ID, accountId: ACCOUNT_ID } },
        trigger: { type: 'push' }
      }
    })
    let resolved = false
    void presentation.then(() => {
      resolved = true
    })
    await vi.waitFor(() =>
      expect(recordHiveMobilePushPresentationAck).toHaveBeenCalledWith(DELIVERY_ID, ACCOUNT_ID)
    )
    await Promise.resolve()

    expect(resolved).toBe(false)

    finishPersistence()
    await presentation
    expect(resolved).toBe(true)
  })

  it('shows the native push when acknowledgement persistence exceeds its time budget', async () => {
    vi.useFakeTimers()
    let finishPersistence!: () => void
    const persistence = new Promise<void>((resolve) => {
      finishPersistence = resolve
    })
    vi.mocked(recordHiveMobilePushPresentationAck).mockReturnValueOnce(persistence)

    const presentation = handleForegroundNotificationPresentation({
      request: {
        content: { data: { deliveryId: DELIVERY_ID, accountId: ACCOUNT_ID } },
        trigger: { type: 'push' }
      }
    })
    let resolved = false
    void presentation.then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(recordHiveMobilePushPresentationAck).toHaveBeenCalledWith(DELIVERY_ID, ACCOUNT_ID)

    await vi.advanceTimersByTimeAsync(499)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)

    finishPersistence()
    await presentation
  })

  it('does not acknowledge a native presentation without an account scope', async () => {
    await expect(
      handleForegroundNotificationPresentation({
        request: {
          content: { data: { deliveryId: DELIVERY_ID } },
          trigger: { type: 'push' }
        }
      })
    ).resolves.toMatchObject({ shouldShowBanner: true, shouldShowList: true })

    expect(recordHiveMobilePushPresentationAck).not.toHaveBeenCalled()
  })

  it('does not involve the acknowledgement path for non-push notifications', async () => {
    await expect(
      handleForegroundNotificationPresentation({
        request: { content: { data: {} }, trigger: null }
      })
    ).resolves.toMatchObject({ shouldShowBanner: true, shouldShowList: true })

    expect(recordHiveMobilePushPresentationAck).not.toHaveBeenCalled()
  })

  it('keeps the native presentation committed when acknowledgement persistence fails', async () => {
    vi.mocked(recordHiveMobilePushPresentationAck).mockRejectedValueOnce(new Error('storage'))

    await expect(
      handleForegroundNotificationPresentation({
        request: {
          content: { data: { deliveryId: DELIVERY_ID, accountId: ACCOUNT_ID } },
          trigger: { type: 'push' }
        }
      })
    ).resolves.toMatchObject({ shouldShowBanner: true, shouldShowList: true })
    await Promise.resolve()

    await expect(acquireNotificationDelivery(DELIVERY_ID)).resolves.toBeNull()
  })
})
