import { expect, it, vi } from 'vitest'
import {
  PendingAckStore,
  type PresentationAckStorage
} from './hive-mobile-push-presentation-ack-store'

const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_DEVICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORIGINAL = '11111111-1111-4111-8111-111111111111'
const NEWER = '22222222-2222-4222-8222-222222222222'

// Hive retires confirmed presentation receipts by account/device/delivery identity.
it('retires the acknowledged Hive delivery while retaining newer and foreign owner receipts', async () => {
  const original = {
    accountId: 'account-a',
    deviceId: DEVICE,
    deliveryId: ORIGINAL,
    presentedAt: 1_000
  }
  const newer = { ...original, deliveryId: NEWER, presentedAt: 1_001 }
  const otherAccount = { ...original, accountId: 'account-b' }
  const otherDevice = { ...original, deviceId: OTHER_DEVICE }
  let raw = JSON.stringify({
    schemaVersion: 2,
    pending: [original, newer, otherAccount, otherDevice]
  })
  const storage: PresentationAckStorage = {
    getItem: vi.fn(async () => raw),
    setItem: vi.fn(async (_key: string, value: string) => {
      raw = value
    })
  }
  const store = new PendingAckStore(storage)

  await store.remove('account-a', DEVICE, new Set([ORIGINAL]), 2_000)

  expect(await store.list('account-a', DEVICE, 2_000)).toEqual([newer])
  expect(await store.list('account-b', DEVICE, 2_000)).toEqual([otherAccount])
  expect(await store.list('account-a', OTHER_DEVICE, 2_000)).toEqual([otherDevice])
})
