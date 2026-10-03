import { afterEach, describe, expect, it, vi } from 'vitest'
import { HiveAccountRelayRequests } from './hive-account-relay-requests'
import {
  HiveAccountRelayClosedError,
  HiveAccountRelayDeliveryUnknownError
} from './hive-account-relay-errors'

afterEach(() => vi.useRealTimers())

describe('account relay request delivery evidence', () => {
  it('retains delivery uncertainty after a written request times out', async () => {
    vi.useFakeTimers()
    const requests = new HiveAccountRelayRequests()
    const send = vi.fn()
    const result = requests.request('one', 10, send).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10)
    expect(await result).toBeInstanceOf(HiveAccountRelayDeliveryUnknownError)
    expect(await result).toMatchObject({ code: 'runtime_timeout' })
    expect(send).toHaveBeenCalledOnce()
    expect(requests.size).toBe(0)
  })

  it('keeps a failed write definite and cleans up its pending row', async () => {
    const requests = new HiveAccountRelayRequests()
    const failure = new Error('socket write refused')
    await expect(
      requests.request('one', 10, () => {
        throw failure
      })
    ).rejects.toBe(failure)
    expect(requests.size).toBe(0)
  })

  it('does not contaminate an unwritten request with another request close evidence', async () => {
    const requests = new HiveAccountRelayRequests()
    const failure = new HiveAccountRelayClosedError(4426)
    const written = requests.request('written', 10_000, vi.fn()).catch((error: unknown) => error)
    const unwritten = requests
      .request('unwritten', 10_000, () => requests.rejectAll(failure))
      .catch((error: unknown) => error)
    expect(await written).toBeInstanceOf(HiveAccountRelayDeliveryUnknownError)
    expect(await written).toMatchObject({
      code: 'remote_runtime_upgrade_required',
      closeCode: 4426
    })
    expect(await unwritten).toBe(failure)
    expect(requests.size).toBe(0)
  })

  it('preserves an authoritative host refusal and never retries it', async () => {
    const requests = new HiveAccountRelayRequests()
    const send = vi.fn()
    const result = requests.request('one', 10_000, send)
    const refusal = {
      id: 'one',
      ok: false as const,
      error: { code: 'invalid_argument', message: 'bad' }
    }
    requests.resolve(refusal)
    expect(await result).toBe(refusal)
    expect(send).toHaveBeenCalledOnce()
  })
})
