import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import type { HiveRuntimeCloudWebLaunchService } from '../hive-runtime-cloud/hive-runtime-cloud-web-launch-service'
import { OrcaRuntimeService } from './orca-runtime'
import type { AuthenticatedCloudManagedSocket } from './rpc/mobile-socket-wiring'
import { OrcaRuntimeRpcServer } from './runtime-rpc'

const principal = {
  principalKind: 'cloud_managed_web_session' as const,
  managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
  runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
  expiresAt: Date.parse('2026-08-25T09:00:00.000Z')
}

function cloudSocket(): AuthenticatedCloudManagedSocket {
  return {
    ws: {} as WebSocket,
    connectionId: 'cloud-connection-1',
    principal,
    clientCapabilities: [],
    transport: {
      transport: 'direct',
      request: {
        pathname: '/_hive/runtime-rpc',
        origin: 'https://code.hivekernel.com'
      }
    }
  }
}

describe('OrcaRuntimeRpcServer Cloud-managed session dispatch', () => {
  it('rejects null RPC envelopes on both local and WebSocket transports', async () => {
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath: mkdtempSync(join(tmpdir(), 'hive-cloud-rpc-')),
      enableWebSocket: false
    })
    const reply = vi.fn()
    await server['handleWebSocketMessage']('null', reply, () => {})
    expect(JSON.parse(reply.mock.calls[0]![0])).toMatchObject({
      id: 'unknown',
      ok: false,
      error: { code: 'bad_request' }
    })
    await expect(server['handleMessage']('null')).resolves.toMatchObject({
      id: 'unknown',
      ok: false,
      error: { code: 'bad_request' }
    })
  })

  it('revalidates a tokenless RPC under the non-secret Cloud principal', async () => {
    const runtime = new OrcaRuntimeService()
    const server = new OrcaRuntimeRpcServer({
      runtime,
      userDataPath: mkdtempSync(join(tmpdir(), 'hive-cloud-rpc-')),
      enableWebSocket: false
    })
    const revalidateSession = vi.fn().mockReturnValue(true)
    server.setCloudWebLaunchService({
      revalidateSession
    } as unknown as HiveRuntimeCloudWebLaunchService)
    const replies: Record<string, unknown>[] = []

    await server['handleWebSocketMessage'](
      JSON.stringify({ id: 'cloud-status', method: 'status.get' }),
      (response) => replies.push(JSON.parse(response) as Record<string, unknown>),
      () => {},
      undefined,
      undefined,
      null,
      undefined,
      cloudSocket()
    )

    expect(revalidateSession).toHaveBeenCalledWith(principal)
    expect(replies).toContainEqual(expect.objectContaining({ id: 'cloud-status', ok: true }))
  })

  it.each(['deviceToken', 'sessionToken', 'authToken'])(
    'rejects a repeated %s field before Runtime dispatch',
    async (credentialField) => {
      const server = new OrcaRuntimeRpcServer({
        runtime: new OrcaRuntimeService(),
        userDataPath: mkdtempSync(join(tmpdir(), 'hive-cloud-rpc-')),
        enableWebSocket: false
      })
      const revalidateSession = vi.fn().mockReturnValue(true)
      server.setCloudWebLaunchService({
        revalidateSession
      } as unknown as HiveRuntimeCloudWebLaunchService)
      const replies: Record<string, unknown>[] = []

      await server['handleWebSocketMessage'](
        JSON.stringify({ id: 'cloud-repeated', method: 'status.get', [credentialField]: 'secret' }),
        (response) => replies.push(JSON.parse(response) as Record<string, unknown>),
        () => {},
        undefined,
        undefined,
        null,
        undefined,
        cloudSocket()
      )

      expect(revalidateSession).not.toHaveBeenCalled()
      expect(replies[0]).toMatchObject({
        ok: false,
        error: { code: 'unauthorized' }
      })
    }
  )

  it('fails closed when the Cloud session is no longer current', async () => {
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath: mkdtempSync(join(tmpdir(), 'hive-cloud-rpc-')),
      enableWebSocket: false
    })
    server.setCloudWebLaunchService({
      revalidateSession: vi.fn().mockReturnValue(false)
    } as unknown as HiveRuntimeCloudWebLaunchService)
    const replies: Record<string, unknown>[] = []

    await server['handleWebSocketMessage'](
      JSON.stringify({ id: 'cloud-expired', method: 'status.get' }),
      (response) => replies.push(JSON.parse(response) as Record<string, unknown>),
      () => {},
      undefined,
      undefined,
      null,
      undefined,
      cloudSocket()
    )

    expect(replies[0]).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
  })

  it('keeps Cloud ownership RPCs local-only', async () => {
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath: mkdtempSync(join(tmpdir(), 'hive-cloud-rpc-')),
      enableWebSocket: false
    })
    server.setCloudWebLaunchService({
      revalidateSession: vi.fn().mockReturnValue(true)
    } as unknown as HiveRuntimeCloudWebLaunchService)
    const replies: Record<string, unknown>[] = []

    await server['handleWebSocketMessage'](
      JSON.stringify({ id: 'cloud-local-only', method: 'cloudRuntime.status' }),
      (response) => replies.push(JSON.parse(response) as Record<string, unknown>),
      () => {},
      undefined,
      undefined,
      null,
      undefined,
      cloudSocket()
    )

    expect(replies[0]).toMatchObject({
      ok: false,
      error: { code: 'forbidden' }
    })
  })
})
