// Live (real-socket, real-timer) repro harness for issue #5049: Android
// remote sessions that appear connected but stop responding until the app
// is reopened. Unlike rpc-client.test.ts (fake timers, mocked e2ee), this
// runs the REAL rpc-client with real E2EE v2 against an in-process
// ws server, simulating the Tailscale failure modes behind the report.
//
// Opt-in because the quick scenario takes ~15s wall-clock and the full
// parked-loop scenario ~8 minutes:
//   ORCA_MOBILE_LIVE_REPRO=1 pnpm vitest run src/transport/rpc-client-live-recovery.test.ts
//   ORCA_MOBILE_LIVE_REPRO_FULL=1 ... (adds the 8-minute parked-loop case)
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import nacl from 'tweetnacl'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import { connect, type RpcClient } from './rpc-client'
import { DesktopMobileE2EEV2Session } from '../../../src/shared/runtime-e2ee-server-session'
import { authenticateMobileE2EE } from '../../../src/main/runtime/rpc/mobile-e2ee-auth-validation'

// Why: expo-crypto only exists inside a React Native runtime; Node's CSPRNG
// is equivalent for the harness. Everything else (tweetnacl, the wire
// protocol) is the real production path.
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

// Why: port 0 lets the OS assign a free port so the opt-in harness can't
// fail with EADDRINUSE; the full scenario restarts on the captured port
// because the client keeps reconnecting to its original URL.
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
      const request = JSON.parse(plaintext) as { id: string }
      ws.send(session.sealText(JSON.stringify({ id: request.id, ok: true, result: { up: true } })))
    })
  })
  return new Promise((resolve) => wss.once('listening', () => resolve(wss)))
}

function serverPort(wss: WebSocketServer): number {
  return (wss.address() as AddressInfo).port
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

  it(
    'reaps a half-open link via the foreground probe and recovers',
    { timeout: 60_000 },
    async () => {
      wss = await startServer()
      client = connect(`ws://127.0.0.1:${serverPort(wss)}`, AUTH_TOKEN, serverPublicKeyB64)
      const c = client
      await waitFor('initial connect', 10_000, () => c.getState() === 'connected')
      expect((await c.sendRequest('status.get')).ok).toBe(true)

      // Half-open: server keeps TCP up but stops answering, then the app
      // comes back to the foreground.
      blackhole = true
      c.notifyForeground()
      // Three fair probe windows tolerate transient mobile/Tailscale stalls.
      const detectMs = await waitFor(
        'half-open detected',
        32_000,
        () => c.getState() !== 'connected'
      )
      expect(detectMs).toBeLessThan(30_000)

      blackhole = false
      await waitFor('recovered after link healed', 15_000, () => c.getState() === 'connected')
      expect((await c.sendRequest('status.get')).ok).toBe(true)
    }
  )

  it.runIf(RUN_FULL)(
    'repro: parked retry loop stays stuck until the foreground nudge',
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
      // The attempt counter hits 12 when the final attempt is *scheduled*;
      // its 60s backoff timer is still pending. Let it fire and fail while
      // the server is still down so the loop truly parks.
      await sleep(65_000)
      expect(c.getState()).toBe('reconnecting')

      wss = await startServer(port)
      // Pre-fix behavior: even with the server back, a parked loop never
      // recovers — the user had to restart the app.
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
