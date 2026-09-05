import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { encodePairingOffer, parsePairingCode, type PairingOffer } from './pairing'
import { generateKeyPair, publicKeyToBase64 } from './e2ee-crypto'
import { DesktopMobileE2EEV2Session } from './runtime-e2ee-server-session'
import { RemoteRuntimeRequestConnection } from './remote-runtime-request-connection'
import { remoteRuntimeClientCapabilities } from './remote-runtime-client-capabilities'

type TestServer = {
  wss: WebSocketServer
  pairing: PairingOffer
  requests: unknown[]
  auths: unknown[]
  connectionCount: () => number
}

const servers: WebSocketServer[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          for (const client of server.clients) {
            client.close()
          }
          server.close(() => resolve())
        })
    )
  )
})

describe('RemoteRuntimeRequestConnection', () => {
  it('reuses one encrypted WebSocket for multiple one-shot RPCs', async () => {
    const server = await createServer()
    const connection = new RemoteRuntimeRequestConnection(server.pairing)

    const first = await connection.request('status.get', undefined, 1000)
    const second = await connection.request('terminal.send', { terminal: 't1', text: 'ab' }, 1000)

    expect(first).toMatchObject({
      ok: true,
      result: { method: 'status.get' },
      _meta: { runtimeId: 'runtime-test' }
    })
    expect(second).toMatchObject({
      ok: true,
      result: { method: 'terminal.send' },
      _meta: { runtimeId: 'runtime-test' }
    })
    expect(server.connectionCount()).toBe(1)
    expect(server.auths).toContainEqual(
      expect.objectContaining({
        clientCapabilities: remoteRuntimeClientCapabilities()
      })
    )
    expect(server.requests).toMatchObject([
      { method: 'status.get' },
      { method: 'terminal.send', params: { terminal: 't1', text: 'ab' } }
    ])

    connection.close()
  })

  it('aborts one request without closing the cached connection', async () => {
    const server = await createServer()
    const connection = new RemoteRuntimeRequestConnection(server.pairing)
    const controller = new AbortController()
    const pending = connection.request('test.hang', undefined, 60_000, controller.signal)
    await vi.waitFor(() =>
      expect(server.requests).toContainEqual(expect.objectContaining({ method: 'test.hang' }))
    )

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(
      (connection as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.size
    ).toBe(0)
    await expect(connection.request('status.get', undefined, 1000)).resolves.toMatchObject({
      ok: true,
      result: { method: 'status.get' }
    })
    expect(server.connectionCount()).toBe(1)

    connection.close()
  })
})

async function createServer(): Promise<TestServer> {
  const serverKeyPair = generateKeyPair()
  const requests: unknown[] = []
  const auths: unknown[] = []
  let connectionCount = 0
  // host must match the 127.0.0.1 clients dial: a wildcard bind lets a foreign loopback listener claim the port and answer here.
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  servers.push(wss)

  wss.on('connection', (ws) => {
    connectionCount += 1
    let session: DesktopMobileE2EEV2Session | null = null
    let authenticated = false

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        return
      }
      const frame = data.toString()
      if (!session) {
        session = DesktopMobileE2EEV2Session.create({
          hello: JSON.parse(frame),
          serverSecretKey: serverKeyPair.secretKey,
          expectedContext: { transport: 'direct' }
        })
        if (!session) {
          throw new Error('Invalid handshake')
        }
        ws.send(JSON.stringify(session.ready))
        return
      }

      const plaintext = session.openText(frame)
      if (plaintext === null) {
        return
      }
      if (!authenticated) {
        const auth = JSON.parse(plaintext) as { type: string; deviceToken: string }
        auths.push(auth)
        expect(auth).toEqual({
          type: 'e2ee_auth',
          v: 2,
          transcriptHashB64: session.transcriptHashB64,
          deviceToken: 'device-token',
          clientCapabilities: remoteRuntimeClientCapabilities()
        })
        authenticated = true
        sendEncrypted(ws, session, {
          type: 'e2ee_authenticated',
          v: 2,
          transcriptHashB64: session.transcriptHashB64
        })
        return
      }

      const request = JSON.parse(plaintext) as {
        id: string
        method: string
        params?: unknown
      }
      requests.push(request)
      if (request.method === 'test.hang') {
        return
      }
      sendEncrypted(ws, session, {
        id: request.id,
        ok: true,
        result: { method: request.method },
        _meta: { runtimeId: 'runtime-test' }
      })
    })
  })

  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const address = wss.address() as AddressInfo
  const pairing = parsePairingCode(
    encodePairingOffer({
      v: 2,
      endpoint: `ws://127.0.0.1:${address.port}`,
      deviceToken: 'device-token',
      publicKeyB64: publicKeyToBase64(serverKeyPair.publicKey)
    })
  )
  if (!pairing) {
    throw new Error('Failed to create test pairing')
  }

  return {
    wss,
    pairing,
    requests,
    auths,
    connectionCount: () => connectionCount
  }
}

function sendEncrypted(ws: WebSocket, session: DesktopMobileE2EEV2Session, message: unknown): void {
  ws.send(session.sealText(JSON.stringify(message)))
}
