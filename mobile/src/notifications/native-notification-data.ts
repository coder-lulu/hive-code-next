type NativeNotificationRequest = {
  content: { data?: unknown }
  trigger?: unknown
}

type NativePushNotificationRequest = NativeNotificationRequest & {
  trigger: { type: 'push'; payload?: unknown }
}

export function isNativePushNotificationRequest(
  request: NativeNotificationRequest
): request is NativePushNotificationRequest {
  const trigger = request.trigger
  return Boolean(
    trigger && typeof trigger === 'object' && 'type' in trigger && trigger.type === 'push'
  )
}

export function readNativeNotificationData(request: NativeNotificationRequest): unknown {
  if (isNativePushNotificationRequest(request)) {
    // Expo iOS keeps raw APNs custom fields here when content.data is null.
    if (request.trigger.payload && typeof request.trigger.payload === 'object') {
      return request.trigger.payload
    }
  }
  return request.content.data
}
