import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  scheduleHiveRuntimeCloudHeartbeat,
  scheduleHiveRuntimeCloudInitialPhase
} from './hive-runtime-cloud-presence-scheduling'

afterEach(() => vi.useRealTimers())

describe('Hive Runtime Cloud heartbeat scheduling', () => {
  it.each([
    [0, 27_000],
    [0.5, 30_000],
    [1, 33_000]
  ])('applies ten percent jitter for random value %s', async (random, expectedDelay) => {
    vi.useFakeTimers()
    const action = vi.fn()

    scheduleHiveRuntimeCloudHeartbeat(
      30_000,
      () => random,
      () => true,
      action
    )
    await vi.advanceTimersByTimeAsync(expectedDelay - 1)
    expect(action).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(action).toHaveBeenCalledOnce()
  })

  it.each([
    [0, 0],
    [0.5, 7_500],
    [1, 15_000]
  ])('spreads initial activation for random value %s', async (random, expectedDelay) => {
    vi.useFakeTimers()
    const action = vi.fn()

    scheduleHiveRuntimeCloudInitialPhase(
      15_000,
      () => random,
      () => true,
      action
    )
    if (expectedDelay > 0) {
      await vi.advanceTimersByTimeAsync(expectedDelay - 1)
      expect(action).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
    } else {
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(action).toHaveBeenCalledOnce()
  })
})
