import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEffectTimerRegistry } from './session-effect-timer-registry'

describe('session effect timer registry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs scheduled work while active', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const registry = createEffectTimerRegistry()

    registry.schedule(callback, 25)
    vi.advanceTimersByTime(25)

    expect(callback).toHaveBeenCalledOnce()
    expect(registry.disposed).toBe(false)
  })

  it('cancels pending work and rejects new work after disposal', () => {
    vi.useFakeTimers()
    const pending = vi.fn()
    const late = vi.fn()
    const registry = createEffectTimerRegistry()

    registry.schedule(pending, 25)
    registry.dispose()
    registry.schedule(late, 25)
    vi.runAllTimers()

    expect(pending).not.toHaveBeenCalled()
    expect(late).not.toHaveBeenCalled()
    expect(registry.disposed).toBe(true)
  })
})
