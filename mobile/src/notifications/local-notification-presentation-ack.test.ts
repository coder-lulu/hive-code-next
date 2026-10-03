import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import { showLocalNotification } from './local-notification-scheduling'
import {
  acquireNotificationDelivery,
  resetNotificationDeliveryDedupeForTests
} from './notification-delivery-dedupe'
import { recordHiveMobilePushPresentationAck } from './hive-mobile-push-presentation-ack'
import { loadPushNotificationsEnabled } from '../storage/preferences'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  PermissionStatus: { GRANTED: 'granted' },
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios', Version: 18 } }))
vi.mock('../storage/preferences', () => ({ loadPushNotificationsEnabled: vi.fn() }))
vi.mock('./hive-mobile-push-presentation-ack', () => ({
  recordHiveMobilePushPresentationAck: vi.fn()
}))

const DELIVERY_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_ID = 'account-id'

describe('local notification presentation acknowledgement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetNotificationDeliveryDedupeForTests()
    vi.mocked(recordHiveMobilePushPresentationAck).mockResolvedValue(undefined)
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: Notifications.PermissionStatus.GRANTED,
      expires: 'never',
      granted: true,
      canAskAgain: true
    })
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('scheduled')
  })

  it('records a delivery after the operating system accepts the local notification', async () => {
    await showLocalNotification(
      {
        type: 'notification',
        title: 'Done',
        body: 'Finished',
        deliveryId: DELIVERY_ID,
        accountId: ACCOUNT_ID
      },
      'host-1'
    )

    expect(recordHiveMobilePushPresentationAck).toHaveBeenCalledWith(DELIVERY_ID, ACCOUNT_ID)
  })

  it('waits for acknowledgement persistence before resolving the local presentation', async () => {
    let finishPersistence!: () => void
    const persistence = new Promise<void>((resolve) => {
      finishPersistence = resolve
    })
    vi.mocked(recordHiveMobilePushPresentationAck).mockReturnValueOnce(persistence)

    const presentation = showLocalNotification(
      {
        type: 'notification',
        title: 'Done',
        body: 'Finished',
        deliveryId: DELIVERY_ID,
        accountId: ACCOUNT_ID
      },
      'host-1'
    )
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

  it('keeps a successful local presentation when acknowledgement persistence fails', async () => {
    vi.mocked(recordHiveMobilePushPresentationAck).mockRejectedValueOnce(new Error('storage'))

    await expect(
      showLocalNotification(
        {
          type: 'notification',
          title: 'Done',
          body: 'Finished',
          deliveryId: DELIVERY_ID,
          accountId: ACCOUNT_ID
        },
        'host-1'
      )
    ).resolves.toBeUndefined()
    await Promise.resolve()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledOnce()
    await expect(acquireNotificationDelivery(DELIVERY_ID)).resolves.toBeNull()
  })

  it('does not acknowledge a local presentation without an account scope', async () => {
    await showLocalNotification(
      { type: 'notification', title: 'Done', body: 'Finished', deliveryId: DELIVERY_ID },
      'host-1'
    )

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledOnce()
    expect(recordHiveMobilePushPresentationAck).not.toHaveBeenCalled()
  })

  it('keeps the legacy path unchanged when no delivery id exists', async () => {
    await showLocalNotification({ type: 'notification', title: 'Done', body: 'Finished' }, 'host-1')

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledOnce()
    expect(recordHiveMobilePushPresentationAck).not.toHaveBeenCalled()
  })
})
