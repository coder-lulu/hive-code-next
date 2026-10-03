import { afterEach, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { DesktopMobileE2EEV2Session } from '../../../src/shared/runtime-e2ee-server-session'
import { authenticateMobileE2EE } from '../../../src/main/runtime/rpc/mobile-e2ee-auth-validation'
import { RpcClientSocketSession } from './rpc-client-socket-session'

vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(n).fill(7) }))

class Socket {
  static OPEN = 1
  OPEN = 1
  readyState = 1
  bufferedAmount = 0
  onopen?: () => void
  onmessage?: (event: { data: unknown }) => void
  onclose?: (event: unknown) => void
  onerror?: (event: unknown) => void
  sent: string[] = []
  send(frame: string): void {
    this.sent.push(frame)
  }
  close(): void {
    this.readyState = 3
  }
}

const sessions: RpcClientSocketSession[] = []
afterEach(() => {
  sessions.forEach((session) => {
    session.clearTimers()
    session.clearKey()
  })
  sessions.length = 0
  vi.unstubAllGlobals()
})

function setup() {
  vi.stubGlobal('WebSocket', Socket)
  const serverKey = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(3))
  const onAuthenticated = vi.fn()
  const onAuthRejected = vi.fn()
  const onForcedClose = vi.fn()
  const onRpcResponse = vi.fn()
  const onBinary = vi.fn()
  const session = new RpcClientSocketSession({
    endpoint: 'ws://127.0.0.1:6769',
    deviceToken: 'test-token',
    serverPublicKey: serverKey.publicKey,
    getCurrentSocket: () => session.socket,
    getState: () => 'handshaking',
    getReconnectAttempt: () => 0,
    isIntentionallyClosed: () => false,
    emitLog: vi.fn(),
    onHandshakeStarted: vi.fn(),
    onAuthenticated,
    onAuthRejected,
    onRpcResponse,
    onBinary,
    onAnyInbound: vi.fn(),
    onAuthenticatedInbound: vi.fn(),
    onClosed: vi.fn(),
    onForcedClose
  })
  sessions.push(session)
  const socket = session.socket as unknown as Socket
  socket.onopen!()
  const hello = JSON.parse(socket.sent[0]!)
  expect(hello.v).toBe(2)
  const server = DesktopMobileE2EEV2Session.create({
    hello,
    serverSecretKey: serverKey.secretKey,
    expectedContext: { transport: 'direct' }
  })!
  expect(server).not.toBeNull()
  return {
    session,
    socket,
    server,
    onAuthenticated,
    onAuthRejected,
    onForcedClose,
    onRpcResponse,
    onBinary
  }
}

async function ready(ctx: ReturnType<typeof setup>) {
  ctx.socket.onmessage!({ data: JSON.stringify(ctx.server.ready) })
  await vi.waitFor(() => expect(ctx.socket.sent).toHaveLength(2))
  const plaintext = ctx.server.openText(ctx.socket.sent[1]!)!
  return authenticateMobileE2EE({
    plaintext,
    v2Session: ctx.server,
    resolveDevice: (token) => (token === 'test-token' ? { deviceToken: token } : null)
  })
}

it('authenticates direct pairing against desktop v2 and exchanges RPC and binary frames', async () => {
  const ctx = setup()
  expect((await ready(ctx)).ok).toBe(true)
  ctx.socket.onmessage!({
    data: ctx.server.sealText(
      JSON.stringify({
        type: 'e2ee_authenticated',
        v: 2,
        transcriptHashB64: ctx.server.transcriptHashB64
      })
    )
  })
  await vi.waitFor(() => expect(ctx.onAuthenticated).toHaveBeenCalledOnce())
  expect(ctx.session.sendEncrypted({ id: '1', method: 'status.get' })).toBe(true)
  expect(JSON.parse(ctx.server.openText(ctx.socket.sent[2]!)!)).toEqual({
    id: '1',
    method: 'status.get'
  })
  const response = { id: '1', ok: true, result: { ready: true } }
  ctx.socket.onmessage!({ data: ctx.server.sealText(JSON.stringify(response)) })
  ctx.socket.onmessage!({ data: ctx.server.sealBinary(new Uint8Array([1, 2, 3])) })
  await vi.waitFor(() => expect(ctx.onBinary).toHaveBeenCalledWith(new Uint8Array([1, 2, 3])))
  expect(ctx.onRpcResponse).toHaveBeenCalledWith(response)
  expect(ctx.onForcedClose).not.toHaveBeenCalled()
})

it('reports an encrypted authentication rejection without marking the socket connected', async () => {
  const ctx = setup()
  await ready(ctx)
  ctx.socket.onmessage!({
    data: ctx.server.sealText(
      JSON.stringify({ type: 'e2ee_error', error: { code: 'unauthorized' } })
    )
  })
  await vi.waitFor(() => expect(ctx.onAuthRejected).toHaveBeenCalledOnce())
  expect(ctx.onAuthenticated).not.toHaveBeenCalled()
  expect(ctx.session.sendEncrypted({ id: '1', method: 'status.get' })).toBe(false)
})

it('rejects a server ready with a different pinned public key', async () => {
  const ctx = setup()
  ctx.socket.onmessage!({
    data: JSON.stringify({
      ...ctx.server.ready,
      desktopPublicKeyB64: Buffer.from(nacl.box.keyPair().publicKey).toString('base64')
    })
  })
  await vi.waitFor(() => expect(ctx.onForcedClose).toHaveBeenCalledOnce())
  expect(ctx.onAuthenticated).not.toHaveBeenCalled()
  expect(ctx.socket.sent).toHaveLength(1)
})
