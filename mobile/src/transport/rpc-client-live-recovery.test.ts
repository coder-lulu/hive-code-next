// Exercise authenticated v2 framing with real sockets and timers against half-open paths (#5049).
// ORCA_MOBILE_LIVE_REPRO=1 enables the short case; ORCA_MOBILE_LIVE_REPRO_FULL=1 adds the roughly eight-minute recovery loop.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import { connect, type RpcClient } from './rpc-client'
import { DesktopMobileE2EEV2Session } from '../../../src/shared/runtime-e2ee-server-session'
import { authenticateMobileE2EE } from '../../../src/main/runtime/rpc/mobile-e2ee-auth-validation'

// Use Node secure randomness in place of Expo; keep production crypto/framing for the harness.
vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n))
}))

const RUN_LIVE =
  process.env.ORCA_MOBILE_LIVE_REPRO === '1' || !!process.env.ORCA_MOBILE_LIVE_REPRO_FULL
const RUN_FULL = process.env.ORCA_MOBILE_LIVE_REPRO_FULL === '1'

const AUTH_TOKEN = 'repro-device-token'

const serverKeyPair = nacl.box.keyPair()
const serverPublicKeyB64 = Buffer.from(serverKeyPair.publicKey).toString('base64')

// When true the server accepts traffic but never replies — simulates a
// half-open link where TCP looks alive but the path is dead.
let blackhole = false

function startServer(port = 0): Promise<WebSocketServer> {
  // host must match the 127.0.0.1 clients dial: a wildcard bind lets a foreign loopback listener claim the port and answer here.
  const wss = new WebSocketServer({ host: '127.0.0.1', port })
  wss.on('connection', (ws: ServerSocket) => {
    let session: DesktopMobileE2EEV2Session | null = null
    let authenticated = false
    ws.on('message', (data) => {
      if (blackhole) {
        return
      }
      const msg = typeof data === 'string' ? data : data.toString('utf-8')
      if (!session) {
        session = DesktopMobileE2EEV2Session.create({
          hello: JSON.parse(msg),
          serverSecretKey: serverKeyPair.secretKey,
          expectedContext: { transport: 'direct' }
        })
        if (!session) {
          ws.close(1008, 'Invalid handshake')
          return
        }
        ws.send(JSON.stringify(session.ready))
        return
      }
      const plaintext = session.openText(msg)
      if (!plaintext) {
        return
      }
      if (!authenticated) {
        const result = authenticateMobileE2EE({
          plaintext,
          v2Session: session,
          resolveDevice: (token) => (token === AUTH_TOKEN ? { deviceToken: token } : null)
        })
        if (result.ok) {
          authenticated = true
          ws.send(
            session.sealText(
              JSON.stringify({
                type: 'e2ee_authenticated',
                v: 2,
                transcriptHashB64: session.transcriptHashB64
              })
            )
          )
        } else {
          ws.close(1008, 'Authentication failed')
        }
        return
      }
      const request: unknown = JSON.parse(plaintext)
      if (
        !request ||
        typeof request !== 'object' ||
        !('id' in request) ||
        typeof request.id !== 'string'
      ) {
        return
      }
      ws.send(session.sealText(JSON.stringify({ id: request.id, ok: true, result: { up: true } })))
    })
  })
  return new Promise((resolve) => wss.once('listening', () => resolve(wss)))
}

function serverPort(wss: WebSocketServer): number {
  const address = wss.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected an assigned loopback port')
  }
  return address.port
}

function stopServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    for (const ws of wss.clients) {
      ws.terminate()
    }
    wss.close(() => resolve())
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(label: string, timeoutMs: number, check: () => boolean): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (check()) {
      return Date.now() - start
    }
    await sleep(200)
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for: ${label}`)
}

describe.runIf(RUN_LIVE)('live foreground recovery (issue #5049)', () => {
  let client: RpcClient | null = null
  let wss: WebSocketServer | null = null

  afterEach(async () => {
    blackhole = false
    client?.close()
    client = null
    if (wss) {
      await stopServer(wss)
      wss = null
    }
  })

  it.each(['focus', 'app-resume', 'network-change'] as const)(
    'reaps a half-open link via %s and recovers',
    { timeout: 60_000 },
    async (reason) => {
      wss = await startServer()
      client = connect(`ws://127.0.0.1:${serverPort(wss)}`, AUTH_TOKEN, serverPublicKeyB64)
      const c = client
      await waitFor('initial connect', 10_000, () => c.getState() === 'connected')
      expect((await c.sendRequest('status.get')).ok).toBe(true)

      // Half-open: server keeps TCP up but stops answering, then the app
      // comes back to the foreground.
      blackhole = true
      c.notifyForeground(reason)
      const detectMs = await waitFor(
        'half-open detected',
        32_000,
        () => c.getState() !== 'connected'
      )
      console.log('[direct-revival-capture]', { reason, detectMs })
      expect(detectMs).toBeLessThan(reason === 'focus' ? 30_000 : 6_000)

      blackhole = false
      await waitFor('recovered after link healed', 15_000, () => c.getState() === 'connected')
      expect((await c.sendRequest('status.get')).ok).toBe(true)
    }
  )

  it.runIf(RUN_FULL)(
    'foreground nudge accelerates recovery while the trickle retry is pending',
    { timeout: 600_000 },
    async () => {
      wss = await startServer()
      const port = serverPort(wss)
      client = connect(`ws://127.0.0.1:${port}`, AUTH_TOKEN, serverPublicKeyB64)
      const c = client
      await waitFor('initial connect', 10_000, () => c.getState() === 'connected')

      await stopServer(wss)
      wss = null
      await waitFor('retry cap scheduled (~5 min)', 480_000, () => c.getReconnectAttempt() >= 12)
      // Wait for the final scheduled retry to fire while the server is still down, beyond the count reaching its cap.
      await sleep(65_000)
      expect(c.getState()).toBe('reconnecting')

      wss = await startServer(port)
      // The next 90-second trickle retry is still pending during this observation.
      await sleep(70_000)
      expect(c.getState()).not.toBe('connected')

      c.notifyForeground()
      await waitFor('foreground nudge recovered the session', 15_000, () => {
        return c.getState() === 'connected'
      })
      expect((await c.sendRequest('status.get')).ok).toBe(true)
    }
  )
})
