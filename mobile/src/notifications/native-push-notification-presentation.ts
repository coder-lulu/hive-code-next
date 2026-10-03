import {
  isNativePushNotificationRequest,
  readNativeNotificationData
} from './native-notification-data'
import {
  acquireNotificationDelivery,
  notificationDeliveryIdFromData
} from './notification-delivery-dedupe'
import { recordHiveMobilePushPresentationAck } from './hive-mobile-push-presentation-ack'

type ForegroundNotification = Readonly<{
  request: {
    content: { data?: unknown }
    trigger?: unknown
  }
}>

const SHOW_NOTIFICATION = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: false
} as const

const HIDE_NOTIFICATION = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false
} as const

const PRESENTATION_ACK_PERSISTENCE_BUDGET_MS = 500

async function waitForPresentationAckPersistence(
  deliveryId: string,
  accountId: string
): Promise<void> {
  const persistence = recordHiveMobilePushPresentationAck(deliveryId, accountId).catch(
    () => undefined
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      persistence,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, PRESENTATION_ACK_PERSISTENCE_BUDGET_MS)
      })
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

function accountIdFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('accountId' in data)) {
    return null
  }
  const { accountId } = data
  return typeof accountId === 'string' && accountId.trim().length > 0 ? accountId : null
}

export async function handleForegroundNotificationPresentation(
  notification: ForegroundNotification
): Promise<typeof SHOW_NOTIFICATION | typeof HIDE_NOTIFICATION> {
  if (!isNativePushNotificationRequest(notification.request)) {
    return SHOW_NOTIFICATION
  }
  const data = readNativeNotificationData(notification.request)
  const deliveryId = notificationDeliveryIdFromData(data)
  const accountId = accountIdFromNotificationData(data)
  const delivery = await acquireNotificationDelivery(deliveryId)
  if (!delivery) {
    return HIDE_NOTIFICATION
  }
  delivery.commit()
  if (deliveryId && accountId) {
    await waitForPresentationAckPersistence(deliveryId, accountId)
  }
  return SHOW_NOTIFICATION
}
