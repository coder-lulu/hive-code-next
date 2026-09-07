import { expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { HiveAccountRelayPool } from './hive-account-relay-pool'
import type { HiveAccountRelaySocket } from './hive-account-relay-channel'

function setup(closeCode: number, autoClose = true) {
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  const createMaterial = vi.fn(async () => ({
    outer: {
      clientAdmissionToken: 'test-only',
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
      ticketSecret: new Uint8Array(32).fill(12),
      runtimePublicKeyB64: Buffer.from(nacl.box.keyPair().publicKey).toString('base64')
    },
    clientKeyPair: nacl.box.keyPair(),
    clientKind: 'WEB' as const
  }))
  const sockets: HiveAccountRelaySocket[] = []
  const pool = new HiveAccountRelayPool({
    createMaterial,
    createSocket: () => {
      const socket: HiveAccountRelaySocket = {
        readyState: 1,
        bufferedAmount: 0,
        binaryType: '',
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close() {},
        send() {}
      }
      sockets.push(socket)
      if (autoClose) {
        queueMicrotask(() => socket.onclose?.({ code: closeCode }))
      }
      return socket
    }
  })
  return { pool, createMaterial, sockets }
}

it.each([1006, 1000])(
  'backs off handshake close %s before acquiring another Intent',
  async (code) => {
    const { pool, createMaterial } = setup(code)
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        await expect(pool.connect()).rejects.toThrow()
      }
      expect(createMaterial).toHaveBeenCalledTimes(1)
      vi.mocked(Date.now).mockReturnValue(1_800_000_000_500)
      await expect(pool.connect()).rejects.toThrow()
      expect(createMaterial).toHaveBeenCalledTimes(2)
      vi.mocked(Date.now).mockReturnValue(1_800_000_001_499)
      await expect(pool.connect()).rejects.toThrow()
      expect(createMaterial).toHaveBeenCalledTimes(2)
      vi.mocked(Date.now).mockReturnValue(1_800_000_001_500)
      await expect(pool.connect()).rejects.toThrow()
      expect(createMaterial).toHaveBeenCalledTimes(3)
    } finally {
      pool.close()
      vi.restoreAllMocks()
    }
  }
)

it('counts each of two simultaneous handshake failures only once', async () => {
  const { pool, createMaterial, sockets } = setup(1006, false)
  try {
    const pending = Promise.allSettled([
      pool.subscribe('first', {}, { onResponse: vi.fn() }),
      pool.subscribe('second', {}, { onResponse: vi.fn() })
    ])
    await vi.waitFor(() => expect(sockets).toHaveLength(2))
    for (const socket of sockets) {
      socket.onclose?.({ code: 1006 })
    }
    await pending
    expect(createMaterial).toHaveBeenCalledTimes(2)
    vi.mocked(Date.now).mockReturnValue(1_800_000_001_000)
    const next = pool.connect().catch((error: unknown) => error)
    await vi.waitFor(() => expect(sockets).toHaveLength(3))
    sockets[2]!.onclose?.({ code: 1006 })
    expect(await next).toBeInstanceOf(Error)
    expect(createMaterial).toHaveBeenCalledTimes(3)
  } finally {
    pool.close()
    vi.restoreAllMocks()
  }
})
