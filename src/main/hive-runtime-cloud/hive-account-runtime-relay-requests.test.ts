import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  REMOTE_RUNTIME_MAX_PENDING_REQUESTS,
  REMOTE_RUNTIME_MAX_SUBSCRIPTIONS
} from '../../shared/remote-runtime-memory-limits'
import { HiveAccountRuntimeRelayRequests } from './hive-account-runtime-relay-requests'

describe('HiveAccountRuntimeRelayRequests admission', () => {
  afterEach(() => vi.useRealTimers())

  it('bounds pending requests before allocating another timeout', async () => {
    const requests = new HiveAccountRuntimeRelayRequests()
    const pending = Array.from({ length: REMOTE_RUNTIME_MAX_PENDING_REQUESTS }, () =>
      requests
        .request(
          60_000,
          () => '{}',
          () => undefined
        )
        .catch(() => undefined)
    )

    await expect(
      requests.request(
        60_000,
        () => '{}',
        () => undefined
      )
    ).rejects.toMatchObject({
      code: 'remote_runtime_busy'
    })
    requests.rejectAll(new Error('test cleanup'))
    await Promise.all(pending)
  })

  it('bounds retained subscription callbacks', () => {
    const requests = new HiveAccountRuntimeRelayRequests()
    const callbacks = { onResponse: vi.fn(), onError: vi.fn() }
    for (let index = 0; index < REMOTE_RUNTIME_MAX_SUBSCRIPTIONS; index++) {
      requests.subscribe(callbacks, () => undefined)
    }

    expect(() => requests.subscribe(callbacks, () => undefined)).toThrow(
      'subscription limit reached'
    )
    requests.notifyClosed()
  })

  it('does not retain a subscription when its initial send fails', () => {
    const requests = new HiveAccountRuntimeRelayRequests()
    const failedCallbacks = { onResponse: vi.fn(), onError: vi.fn(), onClose: vi.fn() }
    expect(() =>
      requests.subscribe(failedCallbacks, () => {
        throw new Error('send failed')
      })
    ).toThrow('send failed')

    requests.notifyClosed()

    expect(failedCallbacks.onClose).not.toHaveBeenCalled()
  })

  it('cancels a queued frame when its request times out before delivery', async () => {
    vi.useFakeTimers()
    const requests = new HiveAccountRuntimeRelayRequests()
    const cancel = vi.fn(() => true)
    const response = requests.request(
      25,
      () => '{}',
      () => ({ cancel })
    )

    const rejected = expect(response).rejects.toMatchObject({ code: 'runtime_timeout' })
    await vi.advanceTimersByTimeAsync(25)

    await rejected
    expect(cancel).toHaveBeenCalledOnce()
  })
})
