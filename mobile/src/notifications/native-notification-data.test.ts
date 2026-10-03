import { expect, it } from 'vitest'
import {
  isNativePushNotificationRequest,
  readNativeNotificationData
} from './native-notification-data'

it('reads actual Expo APNs payloads when content.data is null', () => {
  const orca = {
    hostFingerprint: 'qa-host',
    notificationId: 'done',
    notificationSeq: 4,
    notificationEpoch: 'epoch'
  }
  const data = readNativeNotificationData({
    content: { data: null },
    trigger: { type: 'push', payload: { aps: {}, orca } }
  })
  expect(data).toEqual({ aps: {}, orca })
})

it('keeps Android push and local notification data', () => {
  const data = { hostId: 'host', notificationId: 'done' }
  expect(readNativeNotificationData({ content: { data }, trigger: { type: 'push' } })).toBe(data)
  expect(readNativeNotificationData({ content: { data }, trigger: null })).toBe(data)
})

it('distinguishes remote push requests from locally scheduled notifications', () => {
  expect(isNativePushNotificationRequest({ content: {}, trigger: { type: 'push' } })).toBe(true)
  expect(isNativePushNotificationRequest({ content: {}, trigger: null })).toBe(false)
  expect(isNativePushNotificationRequest({ content: {}, trigger: { type: 'timeInterval' } })).toBe(
    false
  )
})
