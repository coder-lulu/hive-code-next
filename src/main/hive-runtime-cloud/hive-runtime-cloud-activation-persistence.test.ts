import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimedState, fixture } from './hive-runtime-cloud-presence-test-fixture'

afterEach(() => vi.restoreAllMocks())

describe('acquired Runtime lease persistence', () => {
  it.each(['authorityGeneration', 'fencingEpoch'] as const)(
    'rejects a returned %s that differs from the registration before writing or heartbeating',
    async (field) => {
      const { service, client, saveState } = fixture(claimedState())
      const lease = await client.acquireLease()
      client.acquireLease.mockClear()
      client.acquireLease.mockResolvedValueOnce({ ...lease, [field]: lease[field] + 1 })
      try {
        service.setRuntimeReady(true)
        await vi.waitFor(() => expect(service.getState()).toBe('OFFLINE_RETRY'))
        expect(service.getCurrentLeaseContext()).toBeNull()
        expect(client.heartbeat).not.toHaveBeenCalled()
        expect(saveState.mock.calls.at(-1)?.[1]).toMatchObject({
          latestLeaseEpoch: 0,
          authorityGeneration: 1,
          fencingEpoch: 1
        })
      } finally {
        await service.stop()
      }
    }
  )

  it('refuses an acquired lease epoch older than the known registration', async () => {
    const { service, client, saveState } = fixture({ ...claimedState(), latestLeaseEpoch: 7 })
    const lease = await client.acquireLease()
    client.acquireLease.mockClear()
    client.acquireLease.mockResolvedValueOnce({ ...lease, leaseEpoch: 6 })
    try {
      service.setRuntimeReady(true)
      await vi.waitFor(() => expect(service.getState()).toBe('OFFLINE_RETRY'))
      expect(service.getCurrentLeaseContext()).toBeNull()
      expect(client.heartbeat).not.toHaveBeenCalled()
      expect(saveState.mock.calls.at(-1)?.[1].latestLeaseEpoch).toBe(7)
    } finally {
      await service.stop()
    }
  })

  it('keeps an acquired lease unavailable when saving its epoch fails', async () => {
    const { service, client, saveState } = fixture(claimedState())
    saveState.mockImplementationOnce(() => true).mockImplementationOnce(() => false)
    try {
      service.setRuntimeReady(true)
      await vi.waitFor(() => expect(service.getState()).toBe('FENCED'))
      expect(service.getCurrentLeaseContext()).toBeNull()
      expect(client.acquireLease).toHaveBeenCalledOnce()
      expect(client.heartbeat).not.toHaveBeenCalled()
      expect((await client.lookup()).latestLeaseEpoch).toBe(0)
    } finally {
      await service.stop()
    }
  })

  it.each(['sign_out', 'stop'] as const)(
    'discards an acquired lease arriving after %s without saving or publishing it',
    async (action) => {
      const { service, client, saveState } = fixture(claimedState())
      const lease = await client.acquireLease()
      client.acquireLease.mockClear()
      let finish!: (value: typeof lease) => void
      client.acquireLease.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      service.setRuntimeReady(true)
      await vi.waitFor(() => expect(client.acquireLease).toHaveBeenCalledOnce())
      const writes = saveState.mock.calls.length
      const stopping = action === 'stop' ? service.stop() : undefined
      if (action === 'sign_out') {
        service.setAuthorization(null)
      }
      finish(lease)
      await stopping
      await service.stop()
      expect(client.heartbeat).not.toHaveBeenCalled()
      expect(service.getCurrentLeaseContext()).toBeNull()
      expect(saveState).toHaveBeenCalledTimes(writes)
      expect(saveState.mock.calls.at(-1)?.[1].latestLeaseEpoch).toBe(0)
    }
  )
})
