import { afterEach, describe, expect, it, vi } from 'vitest'
import { HiveAccountRuntimeRelayAuthorizationDeadline } from './hive-account-runtime-relay-authorization-deadline'

describe('Hive account Runtime relay authorization deadline', () => {
  afterEach(() => vi.useRealTimers())

  it('expires at the earlier of the relay lease and connection intent', async () => {
    vi.useFakeTimers()
    let now = 1_000
    const onExpired = vi.fn()
    const deadline = new HiveAccountRuntimeRelayAuthorizationDeadline(() => now, onExpired)

    expect(deadline.start(2_000, 1_100)).toBe(true)
    now = 1_099
    await vi.advanceTimersByTimeAsync(99)
    expect(onExpired).not.toHaveBeenCalled()
    now = 1_100
    await vi.advanceTimersByTimeAsync(1)
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it('rejects an already expired or non-integer authorization deadline', () => {
    const deadline = new HiveAccountRuntimeRelayAuthorizationDeadline(() => 1_000, vi.fn())

    expect(deadline.start(1_000, 2_000)).toBe(false)
    expect(deadline.start(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(false)
  })
})
