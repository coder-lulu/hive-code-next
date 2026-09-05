import { describe, expect, it, vi } from 'vitest'
import { HiveRuntimeCloudAccountClient } from './hive-runtime-cloud-account-client'
import { HiveAccountRuntimeTransport } from './hive-account-runtime-transport'
import { createHiveAccountRuntimeConnectionMaterial } from './hive-account-runtime-connection-material'
import { EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY } from '../../shared/hive-runtime-cloud'

const uuid = '11111111-1111-4111-8111-111111111111'
describe('account client authorization boundary', () => {
  it('refuses signed-out RPC without acquiring credentials or opening a socket', async () => {
    const directory = {
      getState: () => EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
      getConnectionScope: () => null,
      createConnection: vi.fn(),
      subscribe: (listener: (state: typeof EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY) => void) => {
        listener(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY)
        return vi.fn()
      }
    }
    const socket = vi.fn()
    const transport = new HiveAccountRuntimeTransport(directory, socket)
    const claim = { runtimeRecordId: uuid } as never
    await expect(transport.call(claim, 'status.get', {})).rejects.toThrow('unavailable')
    expect(await transport.getStatus(claim)).toMatchObject({ ok: false })
    expect(directory.createConnection).not.toHaveBeenCalled()
    expect(socket).not.toHaveBeenCalled()
    transport.stop()
  })
  it('does not request material for an expired account session', async () => {
    const createConnectionIntent = vi.fn()
    await expect(
      createHiveAccountRuntimeConnectionMaterial({
        runtimeRecordId: uuid,
        expectedResourceVersion: 1,
        authorization: { sessionExpiresAt: 0 } as never,
        client: { createConnectionIntent },
        findEntry: vi.fn(),
        now: () => 1,
        assertAuthorizationCurrent: vi.fn()
      })
    ).rejects.toThrow('signed_out')
    expect(createConnectionIntent).not.toHaveBeenCalled()
  })
  it('calls the current Intent endpoint and accepts its actual 201 status', async () => {
    const response = {
      protocolVersion: 2,
      intentId: uuid,
      ticketId: uuid,
      expiresAt: Date.now() + 30_000,
      cellUrl: 'https://relay.hivekernel.com',
      cellId: 'cell-01',
      cellIncarnationId: uuid,
      assignmentId: uuid,
      assignmentEpoch: 1,
      relayHostId: 'AbCdEf0123456789',
      clientAdmissionToken: `e30.e30.${'A'.repeat(86)}`,
      runtimePublicKeyB64: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
      e2eeFraming: 'hive-relay-e2ee/v2'
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response), { status: 201 }))
    const client = new HiveRuntimeCloudAccountClient('https://api.hive.example', fetchImpl)
    const body = {
      protocolVersion: 2,
      idempotencyKey: uuid,
      expectedResourceVersion: 1,
      clientKind: 'DESKTOP',
      clientPublicKeyB64: 'A'.repeat(43),
      ticketSecretSha256: 'A'.repeat(43)
    }
    expect(await client.createConnectionIntent(uuid, body, 'test-token', uuid)).toEqual(response)
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.hive.example/hive/v1/runtimes/${uuid}/connection-intents`,
      expect.objectContaining({
        redirect: 'error',
        body: JSON.stringify(body),
        headers: expect.objectContaining({ authorization: 'Bearer test-token' })
      })
    )
  })
})
