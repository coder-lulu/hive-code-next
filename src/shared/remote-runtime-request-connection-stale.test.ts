import { beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import type { PairingOffer } from './pairing'
import { generateKeyPair } from './e2ee-crypto'
import { RuntimeE2EEClientSession } from './runtime-e2ee-client-session'
import { DesktopMobileE2EEV2Session } from './runtime-e2ee-server-session'
import { getRemoteRuntimeRequestAdmissionEvidence } from './remote-runtime-prepared-request-admission'
import type { RemoteRuntimeWebSocketCallbacks } from './remote-runtime-request-websocket'
import { applyProductBranding } from './brand'

const opens: FakeOpenedSocket[] = []
const serverKeys = generateKeyPair()

vi.mock('./remote-runtime-request-websocket', () => ({
  openRemoteRuntimeWebSocket: (
    _pairing: PairingOffer,
    callbacks: RemoteRuntimeWebSocketCallbacks
  ) => {
    const socket = createFakeOpenedSocket(callbacks)
    opens.push(socket)
    return {
      ok: true,
      socket: { ws: socket.ws, session: socket.session, cleanup: socket.cleanup }
    }
  }
}))

type FakeOpenedSocket = {
  ws: WebSocket
  session: RuntimeE2EEClientSession
  serverSession: DesktopMobileE2EEV2Session
  cleanup: ReturnType<typeof vi.fn>
  sent: string[]
  callbacks: RemoteRuntimeWebSocketCallbacks
}

function createFakeOpenedSocket(callbacks: RemoteRuntimeWebSocketCallbacks): FakeOpenedSocket {
  const sent: string[] = []
  const session = RuntimeE2EEClientSession.create({
    desktopPublicKeyB64: Buffer.from(serverKeys.publicKey).toString('base64'),
    transport: 'direct'
  })
  const serverSession = DesktopMobileE2EEV2Session.create({
    hello: session.hello,
    serverSecretKey: serverKeys.secretKey,
    expectedContext: { transport: 'direct' }
  })!
  const ws = {
    readyState: WebSocket.OPEN,
    send: (frame: string) => {
      sent.push(frame)
    },
    close: vi.fn()
  } as unknown as WebSocket
  return {
    ws,
    session,
    serverSession,
    cleanup: vi.fn(),
    sent,
    callbacks
  }
}

function authenticate(socket: FakeOpenedSocket): void {
  socket.callbacks.onTextFrame(socket.ws, JSON.stringify(socket.serverSession.ready))
  expect(JSON.parse(socket.serverSession.openText(socket.sent[0]!)!)).toMatchObject({
    type: 'e2ee_auth',
    v: 2,
    transcriptHashB64: socket.serverSession.transcriptHashB64
  })
  socket.callbacks.onTextFrame(
    socket.ws,
    socket.serverSession.sealText(
      JSON.stringify({
        type: 'e2ee_authenticated',
        v: 2,
        transcriptHashB64: socket.serverSession.transcriptHashB64
      })
    )
  )
}

function latestRequestId(socket: FakeOpenedSocket): string {
  const plaintext = socket.serverSession.openText(socket.sent.at(-1) ?? '')
  if (plaintext === null) {
    throw new Error('missing encrypted request')
  }
  return (JSON.parse(plaintext) as { id: string }).id
}

describe('RemoteRuntimeRequestConnection stale socket callbacks', () => {
  beforeEach(() => {
    opens.splice(0)
  })

  it('runs socket cleanup when the cached connection closes', async () => {
    const { RemoteRuntimeRequestConnection } =
      await import('./remote-runtime-request-connection.js')
    const connection = new RemoteRuntimeRequestConnection({
      v: 2,
      endpoint: 'ws://127.0.0.1:6768',
      deviceToken: 'device-token',
      publicKeyB64: Buffer.from(serverKeys.publicKey).toString('base64')
    })

    const request = connection.request('status.get', undefined, 1000)
    const socket = opens[0]!
    connection.close()
    connection.close()

    await expect(request).rejects.toThrow(
      applyProductBranding('Remote Orca runtime closed the connection.')
    )
    expect(socket.cleanup).toHaveBeenCalledTimes(1)
    expect(socket.ws.close).toHaveBeenCalledTimes(1)
  })

  it('releases a pending request when the cached socket send throws', async () => {
    const { RemoteRuntimeRequestConnection } =
      await import('./remote-runtime-request-connection.js')
    const connection = new RemoteRuntimeRequestConnection({
      v: 2,
      endpoint: 'ws://127.0.0.1:6768',
      deviceToken: 'device-token',
      publicKeyB64: Buffer.from(serverKeys.publicKey).toString('base64')
    })
    const request = connection.request('status.get', undefined, 1000)
    const socket = opens[0]!
    authenticate(socket)
    socket.ws.send = (() => {
      throw new Error('send failed')
    }) as WebSocket['send']

    await expect(request).rejects.toThrow('send failed')
    expect(
      (connection as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.size
    ).toBe(0)
    expect(getRemoteRuntimeRequestAdmissionEvidence()).toEqual({
      pendingRequestCount: 0,
      retainedBytes: 0
    })
    connection.close()
  })

  it('ignores stale socket errors and text frames after a replacement socket opens', async () => {
    vi.useFakeTimers()
    try {
      const { RemoteRuntimeRequestConnection } =
        await import('./remote-runtime-request-connection.js')
      const connection = new RemoteRuntimeRequestConnection({
        v: 2,
        endpoint: 'ws://127.0.0.1:6768',
        deviceToken: 'device-token',
        publicKeyB64: Buffer.from(serverKeys.publicKey).toString('base64')
      })

      const first = connection.request('slow.method', undefined, 10)
      authenticate(opens[0]!)
      const firstRejected = expect(first).rejects.toThrow('Timed out')
      await vi.advanceTimersByTimeAsync(11)
      await firstRejected
      expect(getRemoteRuntimeRequestAdmissionEvidence()).toEqual({
        pendingRequestCount: 0,
        retainedBytes: 0
      })

      const second = connection.request('status.get', undefined, 1000)
      authenticate(opens[1]!)
      await vi.waitFor(() => expect(opens[1]!.sent.length).toBeGreaterThan(1))

      opens[0]!.callbacks.onError(opens[0]!.ws, new Error('stale socket error') as never)
      opens[0]!.callbacks.onTextFrame(
        opens[0]!.ws,
        opens[0]!.serverSession.sealText(JSON.stringify({ id: 'stale', ok: true, result: {} }))
      )

      const requestId = latestRequestId(opens[1]!)
      opens[1]!.callbacks.onTextFrame(
        opens[1]!.ws,
        opens[1]!.serverSession.sealText(
          JSON.stringify({
            id: requestId,
            ok: true,
            result: { state: 'ok' },
            _meta: { runtimeId: 'runtime-2' }
          })
        )
      )

      await expect(second).resolves.toMatchObject({
        ok: true,
        result: { state: 'ok' }
      })
      expect(getRemoteRuntimeRequestAdmissionEvidence()).toEqual({
        pendingRequestCount: 0,
        retainedBytes: 0
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
