import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { generateKeyPair, publicKeyToBase64 } from '../../../shared/e2ee-crypto'
import { DesktopMobileE2EEV2Session } from '../../../shared/runtime-e2ee-server-session'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../../shared/electron-remote-runtime-client-capabilities'
import { encodePairingOffer, parsePairingCode, type PairingOffer } from '../../../shared/pairing'
import { sendRemoteRuntimeRequest } from '../../../shared/remote-runtime-client'

const mocks = vi.hoisted(() => ({ isWebClient: false }))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => mocks.isWebClient }))

import { routeWebRuntimeConnectionFrame } from '@/web/web-runtime-connection-frame-router'
import { webRuntimeAuthenticationFrame } from '@/web/web-runtime-client-protocol'
import { createWebRuntimeTestSession } from '@/web/web-runtime-e2ee-test-peer'
import { pairedHostClientCapabilities } from './paired-host-client-capabilities'

const servers: WebSocketServer[] = []

afterEach(async () => {
  mocks.isWebClient = false
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

/** A paired host that records the capabilities a client authenticates with, then answers. */
async function recordingHost(): Promise<{ pairing: PairingOffer; auth: Promise<unknown> }> {
  const keys = generateKeyPair()
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  servers.push(wss)
  let recordAuth: (auth: unknown) => void = () => undefined
  const auth = new Promise<unknown>((resolve) => {
    recordAuth = resolve
  })
  wss.on('connection', (ws) => {
    let session: DesktopMobileE2EEV2Session | null = null
    let authenticated = false
    ws.on('message', (data) => {
      const frame = data.toString()
      if (!session) {
        session = DesktopMobileE2EEV2Session.create({
          hello: JSON.parse(frame),
          serverSecretKey: keys.secretKey,
          expectedContext: { transport: 'direct' }
        })
        if (!session) {
          throw new Error('Test host rejected the real v2 client hello')
        }
        ws.send(JSON.stringify(session.ready))
        return
      }
      const plaintext = session.openText(frame)
      if (!plaintext) {
        return
      }
      const message: {
        id?: string
        type?: string
        v?: number
        transcriptHashB64?: string
        deviceToken?: string
      } = JSON.parse(plaintext)
      if (!authenticated) {
        expect(message).toMatchObject({
          type: 'e2ee_auth',
          v: 2,
          transcriptHashB64: session.transcriptHashB64,
          deviceToken: 'device-token'
        })
        authenticated = true
        recordAuth(message)
        ws.send(
          session.sealText(
            JSON.stringify({
              type: 'e2ee_authenticated',
              v: 2,
              transcriptHashB64: session.transcriptHashB64
            })
          )
        )
        return
      }
      const reply = { id: message.id, ok: true, result: {}, _meta: { runtimeId: 'host' } }
      ws.send(session.sealText(JSON.stringify(reply)))
    })
  })
  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const address = wss.address()
  if (!address || typeof address === 'string') {
    throw new Error('test host has no port')
  }
  const { port } = address
  const pairing = parsePairingCode(
    encodePairingOffer({
      v: 2,
      endpoint: `ws://127.0.0.1:${port}`,
      deviceToken: 'device-token',
      publicKeyB64: publicKeyToBase64(keys.publicKey)
    })
  )
  if (!pairing) {
    throw new Error('test pairing did not parse')
  }
  return { pairing, auth }
}

// The route decides whether a paired host will admit a chat from these; a list that differs from
// the handshake could open a chat the host refuses, or refuse one it would admit.
describe("this client's capabilities as a paired host receives them", () => {
  it("are the desktop's handshake, as its transports send the Electron list", async () => {
    const host = await recordingHost()

    await sendRemoteRuntimeRequest(
      host.pairing,
      'status.get',
      {},
      2000,
      undefined,
      undefined,
      ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
    )

    await expect(host.auth).resolves.toMatchObject({
      type: 'e2ee_auth',
      clientCapabilities: [...pairedHostClientCapabilities()]
    })
  })

  it("are the browser client's handshake", async () => {
    mocks.isWebClient = true
    const sendEncrypted = vi.fn((_message: unknown) => true)
    const session = createWebRuntimeTestSession(false)

    await routeWebRuntimeConnectionFrame(JSON.stringify(session.server.ready), undefined, {
      getState: () => 'handshaking',
      getSession: () => session.client,
      getSocket: () => null,
      authenticationFrame: () =>
        webRuntimeAuthenticationFrame(
          {
            kind: 'pairing',
            endpoint: 'ws://127.0.0.1',
            publicKeyB64: '',
            deviceToken: 'token'
          },
          session.client.transcriptHashB64
        ),
      pending: new Map(),
      subscriptions: new Map(),
      sendEncrypted,
      setConnected: vi.fn(),
      setAuthFailed: vi.fn(),
      rejectUnauthorized: vi.fn(),
      notifyUnauthorized: vi.fn()
    })

    expect(sendEncrypted).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'e2ee_auth',
        v: 2,
        transcriptHashB64: session.server.transcriptHashB64,
        clientCapabilities: [...pairedHostClientCapabilities()]
      })
    )
  })
})
