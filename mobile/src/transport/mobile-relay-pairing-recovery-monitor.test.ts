import { describe, expect, it, vi } from 'vitest'
import { startMobileRelayPairingRecoveryMonitor } from './mobile-relay-pairing-recovery-monitor'

vi.mock('./connection-revival-triggers', () => ({
  subscribeConnectionRevivalTriggers: vi.fn(() => vi.fn())
}))
vi.mock('./mobile-relay-pairing-recovery', () => ({
  recoverMobileRelayPairing: vi.fn(async () => 'none')
}))

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('startMobileRelayPairingRecoveryMonitor', () => {
  it('retries a deferred journal when connectivity revives', async () => {
    const recover = vi.fn().mockResolvedValueOnce('deferred').mockResolvedValueOnce('recovered')
    let revive: (() => void) | null = null
    const unsubscribe = vi.fn()
    const subscribe = vi.fn((listener: () => void) => {
      revive = listener
      return unsubscribe
    })

    const stop = startMobileRelayPairingRecoveryMonitor({ recover, subscribe })
    await flushPromises()
    expect(recover).toHaveBeenCalledTimes(1)

    revive?.()
    await flushPromises()
    expect(recover).toHaveBeenCalledTimes(2)

    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('coalesces revival signals that arrive during recovery into one retry', async () => {
    let finishFirstRecovery: (() => void) | null = null
    const recover = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<'deferred'>((resolve) => {
            finishFirstRecovery = () => resolve('deferred')
          })
      )
      .mockResolvedValue('recovered')
    let revive: (() => void) | null = null
    const subscribe = vi.fn((listener: () => void) => {
      revive = listener
      return vi.fn()
    })

    startMobileRelayPairingRecoveryMonitor({ recover, subscribe })
    await flushPromises()
    revive?.()
    revive?.()
    expect(recover).toHaveBeenCalledTimes(1)

    finishFirstRecovery?.()
    await flushPromises()
    expect(recover).toHaveBeenCalledTimes(2)
  })
})
