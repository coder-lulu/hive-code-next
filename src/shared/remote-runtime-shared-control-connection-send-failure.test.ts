import { generateKeyPair } from './e2ee-crypto'
import { RuntimeE2EEClientSession } from './runtime-e2ee-client-session'
import { DesktopMobileE2EEV2Session } from './runtime-e2ee-server-session'
import { describe, expect, it, vi } from 'vitest'
import { getRemoteRuntimeRequestAdmissionEvidence } from './remote-runtime-prepared-request-admission'
import { RemoteRuntimeSharedControlConnection } from './remote-runtime-shared-control-connection'

describe('RemoteRuntimeSharedControlConnection send failures', () => {
  it('releases a pending request when the socket send throws', async () => {
    const serverKeys = generateKeyPair()
    const session = RuntimeE2EEClientSession.create({
      desktopPublicKeyB64: Buffer.from(serverKeys.publicKey).toString('base64'),
      transport: 'direct'
    })
    const serverSession = DesktopMobileE2EEV2Session.create({
      hello: session.hello,
      serverSecretKey: serverKeys.secretKey,
      expectedContext: { transport: 'direct' }
    })!
    expect(session.acceptReady(serverSession.ready)).toBe(true)
    const connection = new RemoteRuntimeSharedControlConnection({
      v: 2,
      endpoint: 'ws://127.0.0.1:1',
      deviceToken: 'token',
      publicKeyB64: Buffer.from(serverKeys.publicKey).toString('base64')
    })
    const unsafe = connection as unknown as {
      state: string
      ws: { readyState: number; send: () => void; close: () => void } | null
      session: RuntimeE2EEClientSession | null
      pendingRequests: Map<string, unknown>
    }
    unsafe.state = 'ready'
    unsafe.ws = {
      readyState: 1,
      send: () => {
        throw new Error('send failed')
      },
      close: vi.fn()
    }
    unsafe.session = session

    await expect(connection.request('worktree.ps', undefined, 1000)).rejects.toMatchObject({
      code: 'remote_runtime_unavailable'
    })
    expect(unsafe.pendingRequests.size).toBe(0)
    expect(getRemoteRuntimeRequestAdmissionEvidence()).toEqual({
      pendingRequestCount: 0,
      retainedBytes: 0
    })
    connection.close()
  })
})
