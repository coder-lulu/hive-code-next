import { generateKeyPair } from './e2ee-crypto'
import {
  createPairedE2EEClientHandshake,
  type PairedE2EEClientHandshake
} from './paired-e2ee-client-handshake'
import { NODE_PAIRED_E2EE_PRIMITIVES } from './paired-e2ee-node-primitives'
import { pairedRuntimeConnectionFromOffer } from './paired-runtime-connection'
import { DesktopMobileE2EEV2Session } from './runtime-e2ee-server-session'
import { describe, expect, it, vi } from 'vitest'
import { getRemoteRuntimeRequestAdmissionEvidence } from './remote-runtime/requests/remote-runtime-prepared-request-admission'
import { RemoteRuntimeSharedControlConnection } from './remote-runtime/control/remote-runtime-shared-control-connection'

describe('RemoteRuntimeSharedControlConnection send failures', () => {
  it('releases a pending request when the socket send throws', async () => {
    const serverKeys = generateKeyPair()
    const handshake = createPairedE2EEClientHandshake({
      primitives: NODE_PAIRED_E2EE_PRIMITIVES,
      hostPublicKeyB64: Buffer.from(serverKeys.publicKey).toString('base64'),
      framing: 'v2',
      transport: 'direct'
    })
    const serverSession = DesktopMobileE2EEV2Session.create({
      hello: JSON.parse(handshake.helloText()),
      serverSecretKey: serverKeys.secretKey,
      expectedContext: { transport: 'direct' }
    })!
    expect(handshake.acceptReadyText(JSON.stringify(serverSession.ready))).toBe('accepted')
    const connection = new RemoteRuntimeSharedControlConnection(
      pairedRuntimeConnectionFromOffer({
        v: 2,
        endpoint: 'ws://127.0.0.1:1',
        deviceToken: 'token',
        publicKeyB64: Buffer.from(serverKeys.publicKey).toString('base64')
      })
    )
    // SAFETY: inject only the ready transport state to exercise a synchronous socket-send failure.
    const unsafe = connection as unknown as {
      state: string
      ws: { readyState: number; send: () => void; close: () => void } | null
      handshake: PairedE2EEClientHandshake | null
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
    unsafe.handshake = handshake

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
