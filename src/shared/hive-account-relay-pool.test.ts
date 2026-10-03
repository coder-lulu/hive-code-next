import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountRelayMaterial } from './hive-account-relay-material'
import type { HiveAccountRelaySubscription } from './hive-account-relay-channel'

const state = vi.hoisted(() => ({
  request: vi.fn(),
  subscribe: vi.fn(),
  afterConnect: null as (() => void | Promise<void>) | null,
  channels: [] as {
    isClosed: boolean
    callbacks: HiveAccountRelaySubscription | null
    close: (error?: Error) => void
  }[]
}))
vi.mock('./hive-account-relay-channel', () => ({
  HiveAccountRelayChannel: class {
    isClosed = false
    get isReady() {
      return !this.isClosed
    }
    callbacks: HiveAccountRelaySubscription | null = null
    constructor(private options: { onClosed: (error: Error, intentional: boolean) => void }) {
      state.channels.push(this)
    }
    async connect() {
      await state.afterConnect?.()
    }
    async request(...args: unknown[]) {
      state.request(...args)
      return { id: 'reply', ok: true, result: 'ok', _meta: { runtimeId: 'runtime' } }
    }
    subscribe(request: unknown, callbacks: HiveAccountRelaySubscription) {
      state.subscribe(request)
      this.callbacks = callbacks
    }
    sendBinary() {
      return !this.isClosed
    }
    close(error?: Error) {
      if (this.isClosed) {
        return
      }
      this.isClosed = true
      this.options.onClosed(error ?? new Error('disposed'), !error)
      this.callbacks?.onClose?.()
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
  state.request.mockReset()
  state.subscribe.mockReset()
  vi.useRealTimers()
})

describe('account relay pool ownership and bounds', () => {
  it.each([
    [1000, 1000],
    [{ timeoutMs: 2000 }, 2000],
    [{}, undefined],
    [undefined, undefined]
  ] as const)(
    'keeps a typed or legacy probe on its subscription channel: %j',
    async (timeout, expected) => {
      const { pool } = setup()
      const stream = await pool.subscribe('watch', {}, { onResponse: vi.fn() })
      const channelCount = state.channels.length
      state.request.mockClear()
      await expect(stream.sendRequest('status.get', undefined, timeout)).resolves.toMatchObject({
        ok: true
      })
      expect(state.channels).toHaveLength(channelCount)
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'status.get' }),
        expected
      )
      stream.close()
      await expect(stream.sendRequest('status.get', undefined, timeout)).rejects.toThrow()
      expect(state.request).toHaveBeenCalledTimes(1)
    }
  )

  it('reports loss only when the last healthy channel fails unexpectedly', async () => {
    const onConnectionLost = vi.fn()
    const pool = new HiveAccountRelayPool({
      createMaterial: async () => material(),
      createSocket: vi.fn(),
      onConnectionLost
    })
    pools.push(pool)
    await pool.connect()
    await pool.subscribe('events.subscribe', {}, { onResponse: vi.fn() })
    state.channels[0]!.close(new Error('main lost'))
    expect(pool.getState()).toBe('ready')
    expect(onConnectionLost).not.toHaveBeenCalled()
    const error = new Error('stream lost')
    state.channels[1]!.close(error)
    expect(pool.getState()).toBe('idle')
    expect(onConnectionLost).toHaveBeenCalledExactlyOnceWith(error)
  })

  it('does not report intentional idle retirement as connection loss', async () => {
    vi.useFakeTimers()
    const onConnectionLost = vi.fn()
    const pool = new HiveAccountRelayPool({
      createMaterial: async () => material(),
      createSocket: vi.fn(),
      onConnectionLost
    })
    pools.push(pool)
    await pool.connect()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(pool.getState()).toBe('idle')
    expect(onConnectionLost).not.toHaveBeenCalled()
  })

  it('rejects an aborted request before acquiring connection credentials', async () => {
    const { pool, createMaterial } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(
      pool.request('files.upload', {}, 1000, undefined, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(createMaterial).not.toHaveBeenCalled()
    expect(state.request).not.toHaveBeenCalled()
  })

  it('does not deliver an upload aborted while its connection was being established', async () => {
    const { pool } = setup()
    const controller = new AbortController()
    state.afterConnect = () => controller.abort()
    await expect(
      pool.request('files.upload', {}, 1000, undefined, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.request).not.toHaveBeenCalled()
    state.afterConnect = null
    await expect(pool.request('status.get', {})).resolves.toMatchObject({ ok: true })
    expect(state.request).toHaveBeenCalledOnce()
  })

  it('passes the active request signal through to the channel pending-request owner', async () => {
    const { pool } = setup()
    const controller = new AbortController()
    await pool.request('files.upload', { path: '/work/file' }, 1000, undefined, controller.signal)
    expect(state.request).toHaveBeenCalledOnce()
    const [request, remainingMs, signal] = state.request.mock.calls[0]!
    expect(request).toMatchObject({ method: 'files.upload', params: { path: '/work/file' } })
    expect(remainingMs).toEqual(expect.any(Number))
    expect(remainingMs).toBeGreaterThan(0)
    expect(remainingMs).toBeLessThanOrEqual(1000)
    expect(signal).toBe(controller.signal)
  })

  it('times out before credentials finish loading and never sends the expired request', async () => {
    vi.useFakeTimers()
    try {
      let resolveMaterial!: (value: HiveAccountRelayMaterial) => void
      const { pool } = setup(
        vi.fn(
          () =>
            new Promise<HiveAccountRelayMaterial>((resolve) => {
              resolveMaterial = resolve
            })
        )
      )
      let failure: unknown
      void pool.request('browser.tabCreate', {}, 25).catch((error: unknown) => {
        failure = error
      })

      await vi.advanceTimersByTimeAsync(25)

      expect(failure).toMatchObject({ code: 'runtime_timeout' })
      resolveMaterial(material())
      await pool.connect()
      expect(state.request).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds status verification by the same connection acquisition deadline', async () => {
    vi.useFakeTimers()
    try {
      let resolveMaterial!: (value: HiveAccountRelayMaterial) => void
      const { pool } = setup(
        vi.fn(
          () =>
            new Promise<HiveAccountRelayMaterial>((resolve) => {
              resolveMaterial = resolve
            })
        )
      )
      const status = expect(pool.requestStatus(new AbortController().signal)).rejects.toMatchObject(
        { code: 'runtime_timeout' }
      )

      await vi.advanceTimersByTimeAsync(15_000)

      await status
      resolveMaterial(material())
      await pool.connect()
      expect(state.request).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes only the remaining caller budget to a request after connection setup', async () => {
    vi.useFakeTimers()
    try {
      const { pool } = setup(
        vi.fn(
          () =>
            new Promise<HiveAccountRelayMaterial>((resolve) => {
              setTimeout(() => resolve(material()), 400)
            })
        )
      )
      const request = pool.request('browser.goto', {}, 1_000)

      await vi.advanceTimersByTimeAsync(400)
      await request

      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'browser.goto' }),
        600,
        undefined
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('times out a stream subscription while credentials are still pending', async () => {
    vi.useFakeTimers()
    try {
      let resolveMaterial!: (value: HiveAccountRelayMaterial) => void
      const { pool } = setup(
        vi.fn(
          () =>
            new Promise<HiveAccountRelayMaterial>((resolve) => {
              resolveMaterial = resolve
            })
        )
      )
      let failure: unknown
      void pool
        .subscribe('browser.screencast', {}, { onResponse: vi.fn() }, 25)
        .catch((error: unknown) => {
          failure = error
        })

      await vi.advanceTimersByTimeAsync(25)

      expect(failure).toMatchObject({ code: 'runtime_timeout' })
      resolveMaterial(material())
      await vi.advanceTimersByTimeAsync(0)
      expect(state.subscribe).not.toHaveBeenCalled()
      expect(state.channels).toHaveLength(1)
      expect(state.channels[0]!.isClosed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts promptly while credentials are still pending', async () => {
    const { pool } = setup(vi.fn(() => new Promise<HiveAccountRelayMaterial>(() => {})))
    const controller = new AbortController()
    const request = pool.request('browser.tabCreate', {}, 30_000, undefined, controller.signal)

    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.request).not.toHaveBeenCalled()
  })

  it('verifies on an authenticated stream and retires only its status receipt when it closes', async () => {
    const createMaterial = vi.fn(async () => material())
    const onStatusReceiptLost = vi.fn()
    const onStateChange = vi.fn()
    const pool = new HiveAccountRelayPool({
      createMaterial,
      createSocket: vi.fn(),
      onStatusReceiptLost,
      onStateChange
    })
    pools.push(pool)
    const first = await pool.subscribe('first', {}, { onResponse: vi.fn() })
    const second = await pool.subscribe('second', {}, { onResponse: vi.fn() })
    await pool.requestStatus(new AbortController().signal)
    expect(createMaterial).toHaveBeenCalledTimes(2)
    first.close()
    await Promise.resolve()
    expect(onStatusReceiptLost).toHaveBeenCalledOnce()
    expect(pool.getState()).toBe('ready')
    expect(onStateChange).not.toHaveBeenCalledWith('idle')
    await pool.requestStatus(new AbortController().signal)
    expect(createMaterial).toHaveBeenCalledTimes(2)
    second.close()
    await Promise.resolve()
    expect(onStatusReceiptLost).toHaveBeenCalledTimes(2)
    expect(pool.getState()).toBe('idle')
  })
  it.each(['assignmentEpoch', 'cellIncarnationId'] as const)(
    'reuses and idles the replacement main after %s changes',
    async (field) => {
      vi.useFakeTimers()
      const replacement = material()
      if (field === 'assignmentEpoch') {
        replacement.outer.assignmentEpoch = 2
      } else {
        replacement.outer.cellIncarnationId = 'replacement'
      }
      const factory = vi
        .fn()
        .mockResolvedValueOnce(material())
        .mockImplementation(async () => replacement)
      const { pool } = setup(factory)
      try {
        await pool.request('status.get', {})
        await vi.advanceTimersByTimeAsync(30_000)
        await pool.request('status.get', {})
        await pool.request('status.get', {})
        expect(factory).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(30_000)
        expect(state.channels.every((channel) => channel.isClosed)).toBe(true)
      } finally {
        pool.close()
        vi.useRealTimers()
      }
    }
  )

  it('replaces an old main when a stream moves to a new Assignment', async () => {
    const replacement = material()
    replacement.outer.assignmentEpoch = 2
    const factory = vi
      .fn()
      .mockResolvedValueOnce(material())
      .mockImplementation(async () => replacement)
    const { pool } = setup(factory)
    await pool.request('status.get', {})
    const stream = await pool.subscribe('watch', {}, { onResponse: vi.fn() })
    expect(state.channels[0]!.isClosed).toBe(true)
    await pool.request('status.get', {})
    await pool.request('status.get', {})
    expect(factory).toHaveBeenCalledTimes(3)
    expect(stream.sendBinary(new Uint8Array([1]))).toBe(true)
  })

  it('does not publish ready after close during a connection completion', async () => {
    const { pool } = setup()
    state.afterConnect = () => pool.close()
    await expect(pool.connect()).rejects.toThrow()
    expect(pool.getState()).toBe('closed')
  })

  it('normalizes throttled stream failures for renderer reconnect and preserves retry metadata', async () => {
    const error = Object.assign(new Error('Rate limited'), { status: 429, retryAfterMs: 30_000 })
    const { pool, createMaterial } = setup(
      vi.fn(async () => {
        throw error
      })
    )
    const onError = vi.fn()
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        pool.subscribe('watch', { index }, { onResponse: vi.fn(), onError })
      )
    )
    expect(createMaterial).toHaveBeenCalledTimes(1)
    for (const result of results) {
      expect(result).toMatchObject({
        status: 'rejected',
        reason: {
          code: 'remote_runtime_unavailable',
          retryable: true,
          status: 429,
          retryAfterMs: 30_000
        }
      })
    }
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'remote_runtime_unavailable',
        message: 'Could not connect to the remote HiveCode runtime.',
        retryable: true,
        status: 429,
        retryAfterMs: 30_000
      })
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
    expect(subscriptions.filter((value) => value.status === 'fulfilled')).toHaveLength(15)
    expect(createMaterial).toHaveBeenCalledTimes(15)
    expect(state.channels).toHaveLength(15)
    // Even a full stream budget must leave room for cancel/write/control RPCs.
    await expect(pool.request('terminal.send', {})).resolves.toMatchObject({ ok: true })
    expect(state.channels).toHaveLength(16)
  })

  it('opens terminal and native chat streams alongside workspace subscriptions', async () => {
    const { pool } = setup()
    await pool.connect()
    const methods = [
      'session.tabs.subscribeAll',
      'agentStatus.subscribe',
      'workspacePorts.subscribe',
      'settings.subscribe',
      'session.tabs.subscribe',
      'files.watch',
      'git.watch',
      'terminal.multiplex',
      'nativeChat.subscribe'
    ]
    for (const method of methods) {
      await expect(pool.subscribe(method, {}, { onResponse: vi.fn() })).resolves.toBeDefined()
    }
    await expect(pool.request('terminal.send', {})).resolves.toMatchObject({ ok: true })
  })

  it('counts handshaking channels once when another subscription batch arrives', async () => {
    let release!: () => void
    const handshake = new Promise<void>((resolve) => {
      release = resolve
    })
    state.afterConnect = () => handshake
    const { pool } = setup()
    const first = Array.from({ length: 5 }, (_, index) =>
      pool.subscribe('watch', { index }, { onResponse: vi.fn() })
    )
    await vi.waitFor(() => expect(state.channels).toHaveLength(5))
    const second = Array.from({ length: 10 }, (_, index) =>
      pool.subscribe('watch', { index: index + 5 }, { onResponse: vi.fn() })
    )
    const results = Promise.allSettled([...first, ...second])
    release()
    expect((await results).every((result) => result.status === 'fulfilled')).toBe(true)
    expect(state.channels).toHaveLength(15)
    await expect(pool.request('terminal.send', {})).resolves.toMatchObject({ ok: true })
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
