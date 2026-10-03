import { afterEach, expect, it, vi } from 'vitest'
import { HiveAccountRelayRequests } from '../../../src/shared/hive-account-relay-requests'
import { isRpcDeliveryUnknown } from './rpc-delivery-ambiguity'

afterEach(() => vi.useRealTimers())

it('carries account relay write evidence into mobile mutation classification', async () => {
  vi.useFakeTimers()
  const requests = new HiveAccountRelayRequests()
  const sent = requests.request('sent', 10, vi.fn()).catch((error: unknown) => error)
  const unwritten = new Error('buffer full')
  const refused = requests
    .request('refused', 10, () => {
      throw unwritten
    })
    .catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(10)
  expect(isRpcDeliveryUnknown(await sent)).toBe(true)
  expect(isRpcDeliveryUnknown(await refused)).toBe(false)
  expect(await refused).toBe(unwritten)
})
