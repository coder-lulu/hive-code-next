import { mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { z } from 'zod'
import { HiveRuntimeCloudWebLaunchService } from '../hive-runtime-cloud/hive-runtime-cloud-web-launch-service'
import { HiveRuntimeDisplayMetadataError } from '../hive-runtime-cloud/hive-runtime-cloud-display-metadata-service'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import type { AuthenticatedCloudManagedSocket } from './rpc/mobile-socket-wiring'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
vi.mock('ws')

const principal = {
  principalKind: 'cloud_managed_web_session' as const,
  managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
  runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
  expiresAt: Date.now() + 60_000
}
const socket: AuthenticatedCloudManagedSocket = {
  ws: new WebSocket('ws://127.0.0.1:1234'),
  principal,
  connectionId: 'metadata-connection',
  clientCapabilities: [],
  transport: {
    transport: 'direct',
    request: { pathname: '/_hive/runtime-rpc', origin: 'https://code.hivekernel.com' }
  }
}

function fixture() {
  const directory = join(process.cwd(), 'logs/runtime-cloud-alias-development-20261003/rpc')
  mkdirSync(directory, { recursive: true })
  const server = new OrcaRuntimeRpcServer({
    runtime: new OrcaRuntimeService(),
    userDataPath: mkdtempSync(join(directory, 'test-')),
    enableWebSocket: false
  })
  const service = new HiveRuntimeCloudWebLaunchService({
    apiBaseUrl: 'https://api.hivekernel.com',
    config: {
      publicOrigin: 'https://code.hivekernel.com',
      webClientPath: '/web-index.html',
      websocketPath: '/_hive/runtime-rpc'
    },
    presence: { getCurrentLeaseContext: () => null, subscribeLeaseContext: () => () => undefined },
    client: { consumeConnectionTicket: vi.fn(), readWebSessionDisplayMetadata: vi.fn() },
    getServerPublicKey: () => null,
    terminateSessionConnections: vi.fn()
  })
  const revalidateSession = vi.spyOn(service, 'revalidateSession').mockReturnValue(true)
  const readDisplayMetadata = vi.spyOn(service, 'readDisplayMetadata').mockResolvedValue({
    protocolVersion: 'web-session-display-metadata/v1',
    managedWebSessionId: principal.managedWebSessionId,
    runtimeSessionId: principal.runtimeSessionId,
    status: 'ACTIVE',
    controlVersion: 1,
    runtimeDisplayMetadata: {
      runtimeRecordId: '323e4567-e89b-42d3-a456-426614174000',
      resourceVersion: 1,
      ownershipEpoch: 8,
      cloudDisplayName: null,
      cloudDisplayNameVersion: 1,
      deviceName: null
    }
  })
  server.setCloudWebLaunchService(service)
  const call = async (params: unknown = {}, cloud: boolean = true) => {
    const reply = vi.fn()
    await server['handleWebSocketMessage'](
      JSON.stringify({ id: 'metadata', method: 'cloudRuntime.displayMetadata', params }),
      reply,
      () => {},
      undefined,
      undefined,
      null,
      undefined,
      cloud ? socket : undefined
    )
    return z
      .object({
        ok: z.boolean(),
        error: z.object({ code: z.string(), data: z.unknown().optional() }).optional(),
        result: z.unknown().optional()
      })
      .parse(JSON.parse(reply.mock.calls[0]![0]))
  }
  return { server, revalidateSession, readDisplayMetadata, call }
}

describe('Cloud-managed metadata RPC boundary', () => {
  it('uses the authenticated principal, accepts only empty params and revalidates after the read', async () => {
    const { call, readDisplayMetadata, revalidateSession } = fixture()
    expect(await call()).toMatchObject({ ok: true })
    expect(readDisplayMetadata).toHaveBeenCalledWith(principal, undefined)
    expect(revalidateSession).toHaveBeenCalledTimes(2)
    for (const params of [
      { runtimeRecordId: principal.managedWebSessionId },
      [],
      null,
      { accountId: 'other' }
    ]) {
      expect(await call(params)).toMatchObject({
        ok: false,
        error: { code: 'runtime_display_metadata_request_invalid' }
      })
    }
    expect(readDisplayMetadata).toHaveBeenCalledTimes(1)
  })

  it('rejects the method without a cloud principal and refuses a late result after revocation', async () => {
    const { call, readDisplayMetadata, revalidateSession } = fixture()
    expect(await call({}, false)).toMatchObject({ ok: false })
    expect(readDisplayMetadata).not.toHaveBeenCalled()
    revalidateSession.mockReturnValueOnce(true).mockReturnValueOnce(false)
    expect(await call()).toMatchObject({
      ok: false,
      error: { code: 'runtime_display_metadata_binding_invalid' }
    })
  })

  it('preserves proof errors and retryAfter as machine data rather than an unauthorized session', async () => {
    const { call, readDisplayMetadata } = fixture()
    readDisplayMetadata.mockRejectedValue(
      new HiveRuntimeDisplayMetadataError('runtime_display_metadata_proof_rejected', 12_000)
    )
    expect(await call()).toMatchObject({
      ok: false,
      error: { code: 'runtime_display_metadata_proof_rejected', data: { retryAfterMs: 12_000 } }
    })
  })
})
