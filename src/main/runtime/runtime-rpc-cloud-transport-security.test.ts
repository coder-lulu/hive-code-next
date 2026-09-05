import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import type { HiveRuntimeCloudWebLaunchService } from '../hive-runtime-cloud/hive-runtime-cloud-web-launch-service'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { decrypt, deriveSharedKey, encrypt, encryptBytes, generateKeyPair } from './rpc/e2ee-crypto'
import { nextWsMessage, waitForWsClose } from './runtime-rpc-mobile-ws-test-harness'

const ORIGIN = 'https://code.hivekernel.com'
const PATH = '/_hive/runtime-rpc'
const auth = {
  type: 'e2ee_auth',
  principalKind: 'cloud_managed_web_session',
  managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
  runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
  sessionToken: 'A'.repeat(43)
}

async function openCloudSession(ttl = 60_000) {
  const runtime = new OrcaRuntimeService()
  const cleanup = vi.spyOn(runtime, 'cleanupSubscriptionsForConnection')
  const server = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath: mkdtempSync(join(tmpdir(), 'hive-cloud-ws-')),
    enableWebSocket: true,
    wsPort: 0
  })
  const principal = {
    principalKind: 'cloud_managed_web_session' as const,
    managedWebSessionId: auth.managedWebSessionId,
    runtimeSessionId: auth.runtimeSessionId,
    expiresAt: 0
  }
  const resolveSession = vi.fn(() => {
    principal.expiresAt = Date.now() + ttl
    return principal
  })
  const revalidateSession = vi.fn(() => principal.expiresAt > Date.now())
  server.setCloudWebLaunchService({
    resolveSession,
    revalidateSession
  } as unknown as HiveRuntimeCloudWebLaunchService)
  await server.start()
  const ws = new WebSocket(`${server.getWebSocketEndpoint()}${PATH}`, { origin: ORIGIN })
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    const keys = generateKeyPair()
    const sharedKey = deriveSharedKey(
      keys.secretKey,
      Uint8Array.from(Buffer.from(server.getE2EEPublicKey()!, 'base64'))
    )
    const ready = nextWsMessage(ws)
    ws.send(
      JSON.stringify({
        type: 'e2ee_hello',
        publicKeyB64: Buffer.from(keys.publicKey).toString('base64')
      })
    )
    expect(JSON.parse(await ready)).toEqual({ type: 'e2ee_ready' })
    const authenticated = nextWsMessage(ws)
    ws.send(encrypt(JSON.stringify(auth), sharedKey))
    expect(JSON.parse(decrypt(await authenticated, sharedKey)!)).toEqual({
      type: 'e2ee_authenticated'
    })
    const socket = [...server['mobileSocketWiring']!['authenticatedCloudSockets'].values()][0]!
    return { server, ws, socket, sharedKey, principal, resolveSession, revalidateSession, cleanup }
  } catch (error) {
    ws.terminate()
    await server.stop()
    throw error
  }
}

describe('Cloud session transport security', () => {
  it('passes the real WebSocket upgrade path and Origin into Cloud authentication', async () => {
    const session = await openCloudSession()
    try {
      expect(session.resolveSession).toHaveBeenCalledWith(auth, { pathname: PATH, origin: ORIGIN })
      const response = nextWsMessage(session.ws)
      session.ws.send(
        encrypt(JSON.stringify({ id: 'status', method: 'status.get' }), session.sharedKey)
      )
      expect(JSON.parse(decrypt(await response, session.sharedKey)!)).toMatchObject({
        id: 'status',
        ok: true
      })
      expect(session.revalidateSession).toHaveBeenCalledWith(session.principal)
    } finally {
      session.ws.terminate()
      await session.server.stop()
    }
  })

  it('rejects an expired binary frame before routing and cleans up the connection', async () => {
    const session = await openCloudSession()
    const handleBinary = vi.fn()
    session.server['registerBinaryMessageHandler'](session.socket.connectionId, handleBinary)
    const dispatch = session.server['registerWebSocketDispatchAbort'](session.socket.ws)
    try {
      session.ws.send(encryptBytes(new Uint8Array([1]), session.sharedKey))
      await vi.waitFor(() => expect(handleBinary).toHaveBeenCalledTimes(1))
      // The deadline timer is still a minute away; the frame itself must revalidate the session.
      vi.spyOn(Date, 'now').mockReturnValue(session.principal.expiresAt + 1)
      const closed = waitForWsClose(session.ws)
      session.ws.send(encryptBytes(new Uint8Array([2]), session.sharedKey))
      await closed
      expect(handleBinary).toHaveBeenCalledTimes(1)
      expect(dispatch.signal.aborted).toBe(true)
      await vi.waitFor(() =>
        expect(session.cleanup).toHaveBeenCalledWith(session.socket.connectionId)
      )
      session.server['binaryMessageRouter'].dispatch(
        session.socket.connectionId,
        new Uint8Array([3])
      )
      expect(handleBinary).toHaveBeenCalledTimes(1)
      expect(session.server['cloudSessionExpiryTimers'].size).toBe(0)
    } finally {
      vi.restoreAllMocks()
      session.ws.terminate()
      await session.server.stop()
    }
  })

  it('closes an idle Cloud session at expiry without waiting for control polling', async () => {
    const session = await openCloudSession(200)
    try {
      await waitForWsClose(session.ws)
      await vi.waitFor(() =>
        expect(session.cleanup).toHaveBeenCalledWith(session.socket.connectionId)
      )
      expect(session.server['cloudSessionExpiryTimers'].size).toBe(0)
    } finally {
      session.ws.terminate()
      await session.server.stop()
    }
  })
})
