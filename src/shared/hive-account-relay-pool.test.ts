import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountRelayMaterial } from './hive-account-relay-material'
import type { HiveAccountRelaySubscription } from './hive-account-relay-channel'

const state = vi.hoisted(() => ({
  afterConnect: null as (() => void) | null,
  channels: [] as {
    isClosed: boolean
    callbacks: HiveAccountRelaySubscription | null
    close: () => void
  }[]
}))
vi.mock('./hive-account-relay-channel', () => ({
  HiveAccountRelayChannel: class {
    isClosed = false
    callbacks: HiveAccountRelaySubscription | null = null
    constructor(private options: { onClosed: () => void }) {
      state.channels.push(this)
    }
    async connect() {
      state.afterConnect?.()
    }
    async request() {
      return { id: 'reply', ok: true, result: 'ok', _meta: { runtimeId: 'runtime' } }
    }
    subscribe(_request: unknown, callbacks: HiveAccountRelaySubscription) {
      this.callbacks = callbacks
    }
    sendBinary() {
      return !this.isClosed
    }
    close() {
      if (this.isClosed) {
        return
      }
      this.isClosed = true
      this.callbacks?.onClose?.()
      this.options.onClosed()
    }
  }
}))
import { HiveAccountRelayPool } from './hive-account-relay-pool'

function material(): HiveAccountRelayMaterial {
  return {
    outer: {
      cellId: 'cell',
      cellIncarnationId: 'incarnation',
      assignmentId: 'assignment',
      assignmentEpoch: 1,
      cellUrl: 'https://relay.hive.test',
      clientAdmissionToken: 'cat',
      relayHostId: 'host',
      expiresAt: Date.now() + 60_000
    },
    inner: {
      intentId: 'intent',
      ticketId: 'ticket',
      ticketSecret: new Uint8Array(32).fill(1),
      runtimePublicKeyB64: 'key'
    },
    clientKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32).fill(2) },
    clientKind: 'WEB'
  }
}
const pools: HiveAccountRelayPool[] = []
function setup(createMaterial = vi.fn(async () => material())) {
  const pool = new HiveAccountRelayPool({ createMaterial, createSocket: vi.fn() })
  pools.push(pool)
  return { pool, createMaterial }
}
afterEach(() => {
  for (const pool of pools.splice(0)) {
    pool.close()
  }
  state.channels.length = 0
  state.afterConnect = null
})

describe('account relay pool ownership and bounds', () => {
  it('does not publish ready after close during a connection completion', async () => {
    const { pool } = setup()
    state.afterConnect = () => pool.close()
    await expect(pool.connect()).rejects.toThrow()
    expect(pool.getState()).toBe('closed')
  })

  it('stops queued Intent acquisitions on throttling and preserves callback retry metadata', async () => {
    const error = Object.assign(new Error('Rate limited'), { status: 429, retryAfterMs: 30_000 })
    const { pool, createMaterial } = setup(
      vi.fn(async () => {
        throw error
      })
    )
    const onError = vi.fn()
    await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        pool.subscribe('watch', { index }, { onResponse: vi.fn(), onError })
      )
    )
    expect(createMaterial).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 429, retryAfterMs: 30_000 })
    )
  })

  it('disposes moved Assignment material if closing the old stream closes its owner', async () => {
    const moved = material()
    moved.outer.assignmentEpoch = 2
    const factory = vi.fn().mockResolvedValueOnce(material()).mockResolvedValueOnce(moved)
    const { pool } = setup(factory)
    await pool.subscribe(
      'watch',
      { index: 1 },
      { onResponse: vi.fn(), onClose: () => pool.close() }
    )
    await expect(pool.subscribe('watch', { index: 2 }, { onResponse: vi.fn() })).rejects.toThrow()
    expect(state.channels).toHaveLength(1)
    expect(moved.inner.ticketSecret.every((byte) => byte === 0)).toBe(true)
  })
  it('shares 20 consumers across two streams and isolates stream cancellation', async () => {
    const { pool, createMaterial } = setup()
    const listeners = Array.from({ length: 20 }, () => ({ onResponse: vi.fn(), onBinary: vi.fn() }))
    const handles = await Promise.all(
      listeners.map((listener, index) =>
        pool.subscribe('terminal.subscribe', { terminalId: index % 2 }, listener)
      )
    )
    expect(createMaterial).toHaveBeenCalledTimes(2)
    expect(state.channels).toHaveLength(2)
    state.channels[0]!.callbacks!.onBinary!(new Uint8Array([7]))
    for (let index = 0; index < listeners.length; index++) {
      expect(listeners[index]!.onBinary).toHaveBeenCalledTimes(index % 2 === 0 ? 1 : 0)
    }
    handles[0]!.close()
    expect(state.channels[0]!.isClosed).toBe(false)
    for (let index = 2; index < handles.length; index += 2) {
      handles[index]!.close()
    }
    await Promise.resolve()
    expect(state.channels[0]!.isClosed).toBe(true)
    expect(state.channels[1]!.isClosed).toBe(false)
    expect(handles[1]!.sendBinary(new Uint8Array([8]))).toBe(true)
    await expect(handles[0]!.sendRequest('terminal.write', {}, 1000)).rejects.toThrow()
  })

  it('bounds simultaneous material acquisitions before opening physical channels', async () => {
    const { pool, createMaterial } = setup()
    const subscriptions = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        pool.subscribe('watch', { index }, { onResponse: vi.fn() })
      )
    )
    expect(subscriptions.filter((value) => value.status === 'fulfilled')).toHaveLength(8)
    expect(createMaterial).toHaveBeenCalledTimes(8)
    expect(state.channels).toHaveLength(8)
  })

  it('never revives a pool closed while material acquisition was pending', async () => {
    let resolve!: (value: HiveAccountRelayMaterial) => void
    const created = material()
    const { pool } = setup(
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    )
    const connection = pool.connect()
    await Promise.resolve()
    pool.close()
    resolve(created)
    await expect(connection).rejects.toThrow()
    expect(state.channels).toHaveLength(0)
    expect(created.inner.ticketSecret.every((byte) => byte === 0)).toBe(true)
    expect(pool.getState()).toBe('closed')
  })

  it('bounds requests while credentials are pending, before a socket exists', async () => {
    let resolve!: (value: HiveAccountRelayMaterial) => void
    const { pool, createMaterial } = setup(
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    )
    const requests = Array.from({ length: 64 }, () => pool.request('status.get', {}))
    await expect(pool.request('status.get', {})).rejects.toThrow()
    await Promise.resolve()
    expect(createMaterial).toHaveBeenCalledTimes(1)
    resolve(material())
    expect((await Promise.all(requests)).every((response) => response.ok)).toBe(true)
  })

  it('releases consumer capacity on remote close without requiring callers to dispose twice', async () => {
    const { pool } = setup()
    for (let iteration = 0; iteration < 70; iteration++) {
      await pool.subscribe('watch', {}, { onResponse: vi.fn() })
      state.channels.at(-1)!.close()
    }
    expect(state.channels).toHaveLength(70)
  })

  it('keeps two registrations using the same callback object independently owned', async () => {
    const { pool } = setup()
    const listener = { onResponse: vi.fn() }
    const first = await pool.subscribe('watch', {}, listener)
    const second = await pool.subscribe('watch', {}, listener)
    first.close()
    await Promise.resolve()
    expect(state.channels[0]!.isClosed).toBe(false)
    second.close()
    await Promise.resolve()
    expect(state.channels[0]!.isClosed).toBe(true)
  })
})
