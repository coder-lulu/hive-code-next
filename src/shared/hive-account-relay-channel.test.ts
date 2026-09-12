import { afterEach, describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { HiveAccountRelayChannel, type HiveAccountRelaySocket } from './hive-account-relay-channel'
import type { HiveAccountRelayMaterial } from './hive-account-relay-material'
import { DesktopMobileE2EEV2Session } from './runtime-e2ee-server-session'

const channels: HiveAccountRelayChannel[] = []
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.close()
  }
  vi.useRealTimers()
})

function setup(options: { wrongCell?: boolean; wrongKey?: boolean; silent?: boolean } = {}) {
  const serverKey = nacl.box.keyPair()
  const secret = new Uint8Array(32).fill(12)
  const material = {
    outer: {
      clientAdmissionToken: 'signed-admission',
      cellUrl: 'https://relay.hive.test',
      relayHostId: 'AbCdEf0123_-xyZ9',
      cellId: 'cell-01',
      cellIncarnationId: '22222222-2222-4222-8222-222222222222',
      assignmentId: '33333333-3333-4333-8333-333333333333',
      assignmentEpoch: 1,
      expiresAt: Date.now() + 60_000
    },
    inner: {
      intentId: '44444444-4444-4444-8444-444444444444',
      ticketId: '55555555-5555-4555-8555-555555555555',
      ticketSecret: secret,
      runtimePublicKeyB64: Buffer.from(serverKey.publicKey).toString('base64')
    },
    clientKeyPair: nacl.box.keyPair(),
    clientKind: 'WEB'
  } satisfies HiveAccountRelayMaterial
  const sent: (string | Uint8Array)[] = []
  const requests: Record<string, unknown>[] = []
  let server: DesktopMobileE2EEV2Session | null = null
  let auth: Record<string, unknown> | null = null
  const socket: HiveAccountRelaySocket = {
    readyState: 1,
    bufferedAmount: 0,
    binaryType: '',
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close: vi.fn(),
    send(data) {
      sent.push(data)
      if (options.silent) {
        return
      }
      if (sent.length === 1) {
        emit(
          JSON.stringify({
            type: 'relay-hello',
            v: 2,
            connId: 'conn-01',
            cellId: options.wrongCell ? 'other-cell' : material.outer.cellId,
            cellIncarnationId: material.outer.cellIncarnationId
          })
        )
      } else if (sent.length === 2) {
        server = DesktopMobileE2EEV2Session.create({
          hello: JSON.parse(data as string),
          serverSecretKey: options.wrongKey ? nacl.box.keyPair().secretKey : serverKey.secretKey,
          expectedContext: { transport: 'relay', relayHostId: material.outer.relayHostId }
        })!
        emit(JSON.stringify(server.ready))
      } else if (!auth) {
        auth = JSON.parse(server!.openText(data as string)!)
        emit(
          server!.sealText(
            JSON.stringify({
              type: 'e2ee_authenticated',
              v: 2,
              transcriptHashB64: server!.transcriptHashB64
            })
          )
        )
      } else if (typeof data === 'string') {
        requests.push(JSON.parse(server!.openText(data)!))
      }
    }
  }
  function emit(data: unknown) {
    queueMicrotask(() => socket.onmessage?.({ data }))
  }
  const onClosed = vi.fn()
  const createSocket = vi.fn(() => socket)
  const channel = new HiveAccountRelayChannel({
    material,
    createSocket,
    onClosed,
    handshakeTimeoutMs: 100
  })
  channels.push(channel)
  const ready = channel.connect()
  socket.onopen?.()
  return {
    material,
    channel,
    ready,
    socket,
    sent,
    requests,
    createSocket,
    onClosed,
    emit,
    getAuth: () => auth,
    response: (value: unknown) => emit(server!.sealText(JSON.stringify(value))),
    binary: (value: Uint8Array) => emit(server!.sealBinary(value))
  }
}

describe('account relay physical channel', () => {
  it('cancels only the pending status read and retains the authenticated channel', async () => {
    const peer = setup()
    await peer.ready
    const controller = new AbortController()
    const cancelled = peer.channel.request(
      { id: 'cancelled', method: 'status.get' },
      15_000,
      controller.signal
    )
    controller.abort(new Error('retired status receipt'))
    await expect(cancelled).rejects.toThrow('retired status receipt')
    expect(peer.channel.isReady).toBe(true)
    expect(peer.onClosed).not.toHaveBeenCalled()
    peer.response({ id: 'cancelled', ok: true, result: 'late', _meta: { runtimeId: 'runtime-01' } })
    const current = peer.channel.request({ id: 'current', method: 'status.get' })
    peer.response({ id: 'current', ok: true, result: 'fresh', _meta: { runtimeId: 'runtime-01' } })
    await expect(current).resolves.toMatchObject({ result: 'fresh' })
  })
  it('absorbs the asynchronous ws error when disposed during handshake', async () => {
    const peer = setup({ silent: true })
    Object.defineProperty(peer.socket, 'readyState', { value: 0 })

    peer.channel.close()

    expect(peer.socket.onerror).toEqual(expect.any(Function))
    peer.socket.onerror?.()
    await expect(peer.ready).rejects.toThrow('Relay connection disposed')
  })

  it('keeps credentials inside pinned E2EE and dispatches RPC without device identity', async () => {
    const peer = setup()
    await peer.ready
    expect(peer.createSocket).toHaveBeenCalledWith(
      'wss://relay.hive.test/v1/connect/AbCdEf0123_-xyZ9'
    )
    const outer = JSON.parse(peer.sent[0] as string)
    expect(Object.keys(outer).sort()).toEqual([
      'clientAdmissionToken',
      'clientPublicKeyB64',
      'type',
      'v'
    ])
    expect(outer.clientPublicKeyB64).toBe(
      Buffer.from(peer.material.clientKeyPair.publicKey).toString('base64url')
    )
    expect(peer.getAuth()).toEqual({
      type: 'e2ee_auth',
      principalKind: 'account_runtime_session',
      ticketId: peer.material.inner.ticketId,
      ticketSecret: Buffer.alloc(32, 12).toString('base64url'),
      clientCapabilities: []
    })
    expect(peer.material.inner.ticketSecret.every((byte) => byte === 0)).toBe(true)
    expect(peer.material.clientKeyPair.secretKey.every((byte) => byte === 0)).toBe(true)
    const response = peer.channel.request({ id: 'rpc-1', method: 'runtime.info', params: {} })
    expect(peer.requests).toEqual([{ id: 'rpc-1', method: 'runtime.info', params: {} }])
    peer.response({ id: 'rpc-1', ok: true, result: 'done', _meta: { runtimeId: 'runtime-01' } })
    await expect(response).resolves.toMatchObject({ result: 'done' })
    await expect(
      peer.channel.request({ id: 'bad', method: 'x', deviceToken: 'forbidden' } as never)
    ).rejects.toThrow('bound')
  })

  it.each([{ wrongCell: true }, { wrongKey: true }])(
    'rejects substituted binding before sending secret: %j',
    async (options) => {
      const peer = setup(options)
      await expect(peer.ready).rejects.toThrow()
      expect(peer.getAuth()).toBeNull()
      expect(peer.channel.isClosed).toBe(true)
      expect(peer.onClosed).toHaveBeenCalledWith(expect.any(Error), false)
      expect(peer.material.inner.ticketSecret.every((byte) => byte === 0)).toBe(true)
    }
  )

  it('bounds pending requests and releases them on disconnect', async () => {
    const peer = setup()
    await peer.ready
    const requests = Array.from({ length: 64 }, (_, i) =>
      peer.channel.request({ id: `rpc-${i}`, method: 'wait' })
    )
    await expect(peer.channel.request({ id: 'overflow', method: 'wait' })).rejects.toThrow('limit')
    peer.channel.close()
    expect(
      (await Promise.allSettled(requests)).every((result) => result.status === 'rejected')
    ).toBe(true)
    expect(peer.onClosed).toHaveBeenCalledTimes(1)
    expect(peer.onClosed).toHaveBeenCalledWith(expect.any(Error), true)
  })

  it('routes binary to the exclusive stream and closes its server ownership on unsubscribe', async () => {
    const peer = setup()
    await peer.ready
    const onBinary = vi.fn(),
      onClose = vi.fn()
    const dispose = peer.channel.subscribe(
      { id: 'stream', method: 'terminal.subscribe' },
      { onResponse: vi.fn(), onBinary, onClose }
    )
    expect(() =>
      peer.channel.subscribe({ id: 'other', method: 'watch' }, { onResponse: vi.fn() })
    ).toThrow()
    peer.binary(new Uint8Array([1, 2, 3]))
    await vi.waitFor(() => expect(onBinary).toHaveBeenCalledWith(new Uint8Array([1, 2, 3])))
    const write = peer.channel.request({
      id: 'write',
      method: 'terminal.write',
      params: { data: 'ls' }
    })
    peer.response({ id: 'write', ok: true, result: null, _meta: { runtimeId: 'runtime-01' } })
    await expect(write).resolves.toMatchObject({ ok: true })
    dispose()
    expect(peer.socket.close).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes before creating an unbounded outbound queue', async () => {
    const peer = setup()
    await peer.ready
    Object.defineProperty(peer.socket, 'bufferedAmount', { value: 16 * 1024 * 1024 })
    await expect(peer.channel.request({ id: 'rpc', method: 'runtime.info' })).rejects.toThrow()
    expect(peer.channel.isClosed).toBe(true)
  })

  it('accepts the exact permitted text payload without overcounting ASCII ciphertext bytes', async () => {
    const peer = setup()
    await peer.ready
    const envelope = { id: 'large', ok: true, result: '', _meta: { runtimeId: 'runtime-01' } }
    const length = 4 * 1024 * 1024 - JSON.stringify(envelope).length
    const pending = peer.channel.request({ id: 'large', method: 'fixture.read' })
    peer.response({ ...envelope, result: 'a'.repeat(length) })
    const result = await pending
    expect(result.ok && typeof result.result === 'string' && result.result.length).toBe(length)
  })

  it('terminates stalled authentication and clears one-time credentials', async () => {
    vi.useFakeTimers()
    const peer = setup({ silent: true })
    const rejection = expect(peer.ready).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(101)
    await rejection
    expect(peer.material.inner.ticketSecret.every((byte) => byte === 0)).toBe(true)
  })

  it('fails closed on encrypted replay and bounded inbound flooding', async () => {
    const peer = setup()
    await peer.ready
    // A client-to-server ciphertext cannot authenticate as a server-to-client frame.
    peer.emit(peer.sent[2])
    await vi.waitFor(() => expect(peer.channel.isClosed).toBe(true))
    await expect(peer.channel.connect()).rejects.toThrow('closed')
    const flooded = setup()
    await flooded.ready
    for (let index = 0; index < 65; index++) {
      flooded.socket.onmessage?.({ data: 'bounded' })
    }
    expect(flooded.channel.isClosed).toBe(true)
  })
})
