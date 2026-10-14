import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { WebRuntimeClient } from './web-runtime-client'
import { generateKeyPair, publicKeyToBase64 } from '../../../shared/e2ee-crypto'
import { DesktopMobileE2EEV2Session } from '../../../shared/runtime-e2ee-server-session'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
beforeEach(() =>
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    atob: (v: string) => Buffer.from(v, 'base64').toString('binary'),
    btoa: (v: string) => Buffer.from(v, 'binary').toString('base64')
  })
)
afterEach(() => vi.unstubAllGlobals())
it('receives encrypted subscription binary frames over a paired web socket', async () => {
  vi.stubGlobal('WebSocket', WebSocket)
  const serverKeys = generateKeyPair()
  const frame = new Uint8Array([9, 8, 7])
  // host must match the 127.0.0.1 clients dial: a wildcard bind lets a foreign loopback listener claim the port and answer here.
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  const sockets = new Set<WebSocket>()
  wss.on('connection', (socket) => {
    sockets.add(socket)
    let peer: DesktopMobileE2EEV2Session | null = null
    let authenticated = false
    socket.on('close', () => sockets.delete(socket))
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        return
      }
      if (!peer) {
        peer = DesktopMobileE2EEV2Session.create({
          hello: JSON.parse(data.toString()),
          serverSecretKey: serverKeys.secretKey,
          expectedContext: { transport: 'direct' }
        })
        if (!peer) {
          throw new Error('Invalid current-v2 hello')
        }
        socket.send(JSON.stringify(peer.ready))
        return
      }
      const plaintext = peer.openText(data.toString())
      if (!plaintext) {
        return
      }
      const message = JSON.parse(plaintext) as { id?: string; type?: string }
      if (message.type === 'e2ee_auth') {
        authenticated = true
        socket.send(
          peer.sealText(
            JSON.stringify({
              type: 'e2ee_authenticated',
              v: 2,
              transcriptHashB64: peer.transcriptHashB64
            })
          )
        )
        return
      }
      if (!authenticated || !message.id) {
        return
      }
      const response = {
        id: message.id,
        ok: true,
        streaming: true,
        result: { type: 'ready' },
        _meta: { runtimeId: 'runtime-web-test' }
      } as RuntimeRpcResponse<unknown> & { streaming: true }
      socket.send(peer.sealText(JSON.stringify(response)))
      socket.send(Buffer.from(peer.sealBinary(frame)), { binary: true })
    })
  })
  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const address = wss.address()
  if (!address || typeof address !== 'object') {
    throw new Error('Expected local WebSocket test server address')
  }
  let client: WebRuntimeClient | null = new WebRuntimeClient({
    v: 2,
    endpoint: `ws://127.0.0.1:${address.port}`,
    deviceToken: 'token',
    publicKeyB64: publicKeyToBase64(serverKeys.publicKey)
  })
  try {
    const binaryFrame = new Promise<Uint8Array<ArrayBufferLike>>((resolve, reject) => {
      void client!
        .subscribe(
          'browser.screencast',
          { worktree: 'id:wt-1', page: 'page-1' },
          { onResponse: vi.fn(), onBinary: resolve },
          { timeoutMs: 5_000 }
        )
        .catch(reject)
    })

    expect(Array.from(await binaryFrame)).toEqual([9, 8, 7])
  } finally {
    client.close()
    client = null
    for (const socket of sockets) {
      socket.close()
    }
    await new Promise<void>((resolve, reject) => {
      wss.close((error) => (error ? reject(error) : resolve()))
    })
  }
})
