import { describe, expect, it, vi } from 'vitest'
import { HiveRuntimeCloudAccountClient } from './hive-runtime-cloud-account-client'
import { HiveAccountRuntimeTransport } from './hive-account-runtime-transport'
import { createHiveAccountRuntimeConnectionMaterial } from './hive-account-runtime-connection-material'

describe('account client readiness boundary', () => {
  it('refuses RPC and subscription without acquiring credentials or opening a socket', async () => {
    const directory = { getState: vi.fn(), createConnection: vi.fn(), subscribe: vi.fn() }
    const socket = vi.fn()
    vi.stubGlobal('WebSocket', socket)
    try {
      const transport = new HiveAccountRuntimeTransport(directory)
      const claim = { runtimeRecordId: 'runtime-a' } as never
      await expect(transport.call(claim, 'status.get', {})).rejects.toThrow('not ready')
      await expect(
        transport.subscribe(claim, 'events', {}, undefined, {} as never)
      ).rejects.toThrow('not ready')
      expect(await transport.getStatus(claim)).toMatchObject({
        ok: false,
        error: { code: 'remote_runtime_unavailable' }
      })
      expect(directory.createConnection).not.toHaveBeenCalled()
      expect(socket).not.toHaveBeenCalled()
      transport.stop()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('does not request connection material before the current client is implemented', async () => {
    const createConnectionIntent = vi.fn()
    await expect(
      createHiveAccountRuntimeConnectionMaterial({
        runtimeRecordId: 'runtime-a',
        expectedResourceVersion: 1,
        authorization: { sessionExpiresAt: 100 } as never,
        client: { createConnectionIntent },
        findEntry: vi.fn(),
        now: () => 1,
        assertAuthorizationCurrent: vi.fn()
      })
    ).rejects.toThrow('not ready')
    expect(createConnectionIntent).not.toHaveBeenCalled()
  })
  it('refuses direct API intent creation without sending an HTTP request', async () => {
    const fetchImpl = vi.fn()
    const client = new HiveRuntimeCloudAccountClient('https://api.hive.example', fetchImpl)
    await expect(
      client.createConnectionIntent('runtime', {}, 'credential', 'request')
    ).rejects.toThrow('not ready')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
