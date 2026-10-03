import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HiveRuntimeCloudRequestError,
  HiveRuntimeCloudTransportError
} from './hive-runtime-cloud-client'
import {
  isRetryablePresenceError,
  presenceRetryAfterDelay,
  schedulePresenceRetry
} from './hive-runtime-cloud-presence-support'

afterEach(() => {
  vi.useRealTimers()
})

describe('Hive Runtime Cloud retry classification', () => {
  it('retries only transport, throttling, and service-unavailable failures', () => {
    expect(isRetryablePresenceError(new HiveRuntimeCloudTransportError())).toBe(true)
    expect(isRetryablePresenceError(new HiveRuntimeCloudRequestError(429, null))).toBe(true)
    expect(isRetryablePresenceError(new HiveRuntimeCloudRequestError(503, null))).toBe(true)
    expect(isRetryablePresenceError(new HiveRuntimeCloudRequestError(401, null))).toBe(false)
    expect(isRetryablePresenceError(new Error('invalid response'))).toBe(false)
  })

  it('prefers a server delay with bounded jitter only for throttling and unavailability', () => {
    expect(
      presenceRetryAfterDelay(new HiveRuntimeCloudRequestError(503, null, 10_000), () => 0.5)
    ).toBe(10_500)
    expect(presenceRetryAfterDelay(new HiveRuntimeCloudRequestError(429, null, 500), () => 1)).toBe(
      600
    )
    expect(
      presenceRetryAfterDelay(new HiveRuntimeCloudRequestError(503, null, 30_000), () => 1)
    ).toBe(31_000)
    expect(
      presenceRetryAfterDelay(new HiveRuntimeCloudRequestError(503, null, 60_000), () => 0.5)
    ).toBe(60_500)
    expect(
      presenceRetryAfterDelay(new HiveRuntimeCloudRequestError(401, null, 10_000), () => 1)
    ).toBeUndefined()
    expect(
      presenceRetryAfterDelay(new HiveRuntimeCloudRequestError(503, null), () => 1)
    ).toBeUndefined()
  })

  it('keeps exponential backoff when repeated 503 responses include Retry-After', async () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    const unavailable = new HiveRuntimeCloudRequestError(503, null, 1_000)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      schedulePresenceRetry(
        attempt,
        () => 0.5,
        () => true,
        () => fired(attempt),
        unavailable
      )
    }

    await vi.advanceTimersByTimeAsync(1_050)
    expect(fired.mock.calls).toEqual([[0]])
    await vi.advanceTimersByTimeAsync(1_050)
    expect(fired.mock.calls).toEqual([[0], [1]])
    await vi.advanceTimersByTimeAsync(2_100)
    expect(fired.mock.calls).toEqual([[0], [1], [2]])
    await vi.advanceTimersByTimeAsync(4_200)
    expect(fired.mock.calls).toEqual([[0], [1], [2], [3]])
    await vi.advanceTimersByTimeAsync(8_400)
    expect(fired.mock.calls).toEqual([[0], [1], [2], [3], [4]])
  })

  it('retains jitter when exponential backoff reaches its local cap', async () => {
    vi.useFakeTimers()
    const fired = vi.fn()

    schedulePresenceRetry(
      10,
      () => 0,
      () => true,
      () => fired('minimum')
    )
    schedulePresenceRetry(
      10,
      () => 1,
      () => true,
      () => fired('maximum')
    )

    await vi.advanceTimersByTimeAsync(30_000)
    expect(fired.mock.calls).toEqual([['minimum']])
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fired.mock.calls).toEqual([['minimum'], ['maximum']])
  })
})
