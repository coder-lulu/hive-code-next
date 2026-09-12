import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeHostStatusSnapshot } from '../../../../shared/runtime-host-status'

const mocks = vi.hoisted(() => ({
  pool: null as null | {
    options: { onStateChange: () => void; onStatusReceiptLost: () => void }
    requestStatus: ReturnType<typeof vi.fn>
  }
}))

vi.mock('../../../../shared/hive-account-relay-pool', () => ({
  HiveAccountRelayPool: class {
    requestStatus = vi.fn(async () => ({
      id: 'proof',
      ok: true,
      result: { runtimeId: 'runtime', capabilities: [] },
      _meta: { runtimeId: 'runtime' }
    }))
    constructor(readonly options: { onStateChange: () => void; onStatusReceiptLost: () => void }) {
      mocks.pool = this
    }
    getState(): string {
      return 'ready'
    }
    close(): void {
      this.options.onStateChange()
    }
  }
}))

import { createWebAccountRelayClient } from './web-account-relay-client'

afterEach(() => {
  vi.useRealTimers()
})

describe('account Relay connection-owned status', () => {
  it('verifies real channel status, has no successful polling loop, and retires its exact owner', async () => {
    vi.useFakeTimers()
    const client = createWebAccountRelayClient(vi.fn())
    const snapshots: RuntimeHostStatusSnapshot[] = []
    const verified = vi.fn()
    client.configureStatusOwner!({
      environmentId: 'account-runtime',
      pairingRevision: 7,
      publish: (snapshot) => snapshots.push(snapshot),
      verified
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(client.statusOwner?.read()).toMatchObject({
      environmentId: 'account-runtime',
      pairingRevision: 7,
      verification: 'verified',
      transport: 'ready',
      status: { runtimeId: 'runtime' }
    })
    expect(verified).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.pool!.requestStatus).toHaveBeenCalledOnce()
    await client.call('status.get', undefined)
    expect(mocks.pool!.requestStatus).toHaveBeenCalledTimes(2)
    client.close()
    expect(snapshots.at(-1)).toMatchObject({
      retired: true,
      transport: 'disconnected',
      verification: 'blocked'
    })
  })

  it('re-verifies through a surviving channel when the channel owning the receipt closes', async () => {
    const client = createWebAccountRelayClient(vi.fn())
    const snapshots: RuntimeHostStatusSnapshot[] = []
    client.configureStatusOwner!({
      environmentId: 'account-runtime',
      pairingRevision: 8,
      publish: (snapshot) => snapshots.push(snapshot),
      verified: vi.fn()
    })
    await vi.waitFor(() => expect(client.statusOwner?.read().verification).toBe('verified'))
    const before = mocks.pool!.requestStatus.mock.calls.length
    mocks.pool!.options.onStatusReceiptLost()
    await vi.waitFor(() => expect(mocks.pool!.requestStatus).toHaveBeenCalledTimes(before + 1))
    expect(snapshots.some((snapshot) => snapshot.verification === 'unavailable')).toBe(true)
    expect(snapshots.slice(1).some((snapshot) => snapshot.transport === 'disconnected')).toBe(false)
    await vi.waitFor(() => expect(client.statusOwner?.read().verification).toBe('verified'))
    expect(() =>
      client.configureStatusOwner!({
        environmentId: 'other-runtime',
        pairingRevision: 8,
        publish: vi.fn(),
        verified: vi.fn()
      })
    ).toThrow('another runtime owner')
    client.close()
  })
})
