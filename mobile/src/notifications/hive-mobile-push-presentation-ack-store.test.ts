import { describe, expect, it, vi } from 'vitest'
import {
  PendingAckStore,
  type PresentationAckStorage
} from './hive-mobile-push-presentation-ack-store'

const DEVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function storedDeliveryIds(raw: string): string[] {
  const state: unknown = JSON.parse(raw)
  if (state === null || typeof state !== 'object' || !('pending' in state)) {
    throw new Error('Expected a pending acknowledgement state')
  }
  if (!Array.isArray(state.pending)) {
    throw new Error('Expected pending acknowledgements')
  }
  return state.pending.map((entry: unknown) => {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      !('deliveryId' in entry) ||
      typeof entry.deliveryId !== 'string'
    ) {
      throw new Error('Expected a pending acknowledgement delivery id')
    }
    return entry.deliveryId
  })
}

function indexedDeliveryId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

describe('PendingAckStore', () => {
  it('keeps the newest 4096 acknowledgements globally with stable tie ordering', async () => {
    let raw = JSON.stringify({
      schemaVersion: 2,
      pending: Array.from({ length: 4_097 }, (_, index) => ({
        accountId: `account-${Math.floor(index / 512)}`,
        deviceId: DEVICE_ID,
        deliveryId: indexedDeliveryId(index),
        presentedAt: 1_000
      }))
    })
    const storage: PresentationAckStorage = {
      getItem: vi.fn(async () => raw),
      setItem: vi.fn(async (_key: string, value: string) => {
        raw = value
      })
    }
    const store = new PendingAckStore(storage)

    await store.list('account-8', DEVICE_ID, 1_000)

    const deliveryIds = storedDeliveryIds(raw)
    expect(deliveryIds).toHaveLength(4_096)
    expect(deliveryIds[0]).toBe(indexedDeliveryId(1))
    expect(deliveryIds.at(-1)).toBe(indexedDeliveryId(4_096))
  })
})
