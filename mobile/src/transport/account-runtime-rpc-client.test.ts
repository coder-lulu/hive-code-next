import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountRelayCallbacks } from '../../../src/shared/hive-account-relay-pool-contract'
import { READY_STREAM_RELEASE_METHODS } from './rpc-client-server-subscription'

const fixture = vi.hoisted(() => ({
  connectError: null as unknown,
  subscriptionGate: null as Promise<void> | null,
  appStateListener: null as ((state: string) => void) | null,
  probe: vi.fn(),
  pools: [] as Array<{
    close: ReturnType<typeof vi.fn>
    lose: (error?: unknown) => void
    idle: () => void
    subscriptions: Array<{
      method: string
      callbacks: HiveAccountRelayCallbacks
      close: ReturnType<typeof vi.fn>
    }>
  }>
}))

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (state: string) => void) => {
      fixture.appStateListener = listener
      return { remove: vi.fn() }
    }
  }
}))
vi.mock('./runtime-random', () => ({ mobileRuntimeRandomBytes: vi.fn() }))
vi.mock('../../../src/shared/hive-account-relay-pool', () => ({
  HiveAccountRelayPool: class {
    subscriptions: Array<{
      method: string
      callbacks: HiveAccountRelayCallbacks
      close: ReturnType<typeof vi.fn>
    }> = []
    state = 'ready'
    error: unknown = null
    close = vi.fn()
    constructor(
      private options: {
        onStateChange: (state: string) => void
        onConnectionLost?: (error: unknown) => void
      }
    ) {
      fixture.pools.push(this)
    }
    lose(error: unknown = new Error('Temporary network loss')) {
      this.error = error
      this.idle()
      this.options.onConnectionLost?.(error)
      for (const stream of this.subscriptions) {
        stream.callbacks.onClose?.()
      }
    }
    idle() {
      this.state = 'idle'
      this.options.onStateChange('idle')
    }
    async connect() {
      if (fixture.connectError) {
        throw fixture.connectError
      }
      this.options.onStateChange('ready')
    }
    getState() {
      return this.state
    }
    getLastError() {
      return this.error
    }
    async subscribe(method: string, _params: unknown, callbacks: HiveAccountRelayCallbacks) {
      const close = vi.fn()
      this.subscriptions.push({ method, callbacks, close })
      if (fixture.subscriptionGate) {
        await fixture.subscriptionGate
      }
      return { close, sendRequest: fixture.probe }
    }
    async request() {
      return { id: 'request', ok: true, result: {}, _meta: { runtimeId: 'host' } }
    }
  }
}))

import { AccountRuntimeRpcClient } from './account-runtime-rpc-client'
import { AppState } from 'react-native'

describe('account Runtime independent stream recovery', () => {
  let client: AccountRuntimeRpcClient
  beforeEach(async () => {
    vi.useFakeTimers()
    fixture.pools.length = 0
    fixture.connectError = null
    fixture.subscriptionGate = null
    fixture.probe.mockReset().mockResolvedValue({ id: 'health', ok: true, result: {} })
    AppState.currentState = 'active'
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    client = new AccountRuntimeRpcClient(
      'host',
      {
        runtimeRecordId: 'runtime',
        resourceVersion: 1,
        createConnection: vi.fn()
      },
      vi.fn()
    )
    await Promise.resolve()
  })
  afterEach(() => {
    client.close()
    expect(vi.getTimerCount()).toBe(0)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('recovers only the failed session while healthy subscriptions and RPC stay connected', async () => {
    const healthy = vi.fn()
    client.subscribe('notifications.subscribe', {}, healthy)
    client.subscribe('nativeChat.subscribe', { sessionId: 'session' }, vi.fn())
    await Promise.resolve()
    const pool = fixture.pools[0]!
    pool.subscriptions[1]!.callbacks.onClose?.()
    expect(pool.close).not.toHaveBeenCalled()
    expect(client.getState()).toBe('connected')
    const response = { id: 'event', ok: true as const, result: { type: 'snapshot' } }
    pool.subscriptions[0]!.callbacks.onResponse(response)
    expect(healthy).toHaveBeenCalledWith(response.result)
    await expect(client.sendRequest('status.get')).resolves.toMatchObject({ ok: true })
    await vi.runOnlyPendingTimersAsync()
    expect(pool.subscriptions.map((entry) => entry.method)).toEqual([
      'notifications.subscribe',
      'nativeChat.subscribe',
      'nativeChat.subscribe'
    ])
    expect(fixture.pools).toHaveLength(1)
    // A late close from the previous attachment cannot tear down its replacement.
    pool.subscriptions[1]!.callbacks.onClose?.()
    await vi.runOnlyPendingTimersAsync()
    expect(pool.subscriptions).toHaveLength(3)
  })

  it('retains a subscription after fast retries and recovers it on the slow cadence', async () => {
    const listener = vi.fn()
    client.subscribe('nativeChat.subscribe', {}, listener)
    await Promise.resolve()
    const pool = fixture.pools[0]!
    for (let attempt = 0; attempt < 5; attempt++) {
      pool.subscriptions.at(-1)!.callbacks.onClose?.()
      await vi.runOnlyPendingTimersAsync()
    }
    expect(pool.subscriptions).toHaveLength(6)
    pool.subscriptions.at(-1)!.callbacks.onClose?.()
    await vi.advanceTimersByTimeAsync(89_999)
    expect(pool.subscriptions).toHaveLength(6)
    await vi.advanceTimersByTimeAsync(10_001)
    expect(pool.subscriptions).toHaveLength(7)
    pool.subscriptions
      .at(-1)!
      .callbacks.onResponse({ id: 'restored', ok: true, result: 'restored' })
    expect(listener).toHaveBeenCalledWith('restored')
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    expect(client.getState()).toBe('connected')
    expect(pool.close).not.toHaveBeenCalled()
  })

  it('cancels pending stream recovery when the screen unsubscribes', async () => {
    const release = client.subscribe('nativeChat.subscribe', {}, vi.fn())
    await Promise.resolve()
    const pool = fixture.pools[0]!
    pool.subscriptions[0]!.callbacks.onClose?.()
    release()
    await vi.runOnlyPendingTimersAsync()
    expect(pool.subscriptions).toHaveLength(1)
    expect(pool.close).not.toHaveBeenCalled()
  })

  it('keeps recovering revision conflicts after fast retries without reporting a pairing failure', async () => {
    client.close()
    fixture.pools.length = 0
    fixture.connectError = Object.assign(new Error('revision conflict'), {
      status: 409,
      retryable: false
    })
    client = new AccountRuntimeRpcClient(
      'host',
      {
        runtimeRecordId: 'runtime',
        resourceVersion: 1,
        createConnection: vi.fn()
      },
      vi.fn()
    )
    const states: string[] = []
    client.onStateChange((state) => states.push(state))
    await Promise.resolve()
    await Promise.resolve()
    for (let attempt = 0; attempt < 5; attempt++) {
      await vi.runOnlyPendingTimersAsync()
    }
    expect(fixture.pools).toHaveLength(6)
    expect(states).not.toContain('auth-failed')
    expect(client.getState()).toBe('reconnecting')
    fixture.connectError = null
    await vi.advanceTimersByTimeAsync(100_000)
    expect(fixture.pools).toHaveLength(7)
    expect(client.getState()).toBe('connected')
  })

  it('recovers a lost active pool and reattaches streams without a focus event', async () => {
    client.subscribe('nativeChat.subscribe', {}, vi.fn())
    await Promise.resolve()
    const old = fixture.pools[0]!
    old.lose()
    expect(client.getState()).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)
    expect(fixture.pools).toHaveLength(2)
    expect(fixture.pools[1]!.subscriptions).toHaveLength(1)
    expect(client.getState()).toBe('connected')
    old.lose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fixture.pools).toHaveLength(2)
  })

  it('does not redial an intentionally idle pool without session demand', async () => {
    fixture.pools[0]!.idle()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(fixture.pools).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels lost-pool recovery when the last screen unsubscribes', async () => {
    const release = client.subscribe('nativeChat.subscribe', {}, vi.fn())
    await Promise.resolve()
    fixture.pools[0]!.lose()
    release()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(fixture.pools).toHaveLength(1)
  })

  it('suspends recovery in the background and resumes retained subscriptions', async () => {
    client.subscribe('nativeChat.subscribe', {}, vi.fn())
    await Promise.resolve()
    fixture.pools[0]!.lose()
    AppState.currentState = 'background'
    fixture.appStateListener?.('background')
    await vi.advanceTimersByTimeAsync(300_000)
    expect(fixture.pools).toHaveLength(1)
    AppState.currentState = 'active'
    fixture.appStateListener?.('active')
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.pools).toHaveLength(2)
    expect(fixture.pools[1]!.subscriptions).toHaveLength(1)
  })

  it('does not let focus nudges multiply retries or bypass Retry-After', async () => {
    client.subscribe('nativeChat.subscribe', {}, vi.fn())
    await Promise.resolve()
    fixture.pools[0]!.lose({ status: 429, retryAfterMs: 30_000 })
    client.notifyForeground('focus')
    client.notifyForeground('focus')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(fixture.pools).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fixture.pools).toHaveLength(2)
  })

  it('stops on permanent authorization failure even after foreground nudges', async () => {
    client.subscribe('nativeChat.subscribe', {}, vi.fn())
    await Promise.resolve()
    fixture.pools[0]!.lose({ status: 403 })
    client.notifyForeground('app-resume')
    await vi.advanceTimersByTimeAsync(300_000)
    expect(client.getState()).toBe('auth-failed')
    expect(fixture.pools).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves server cooldown across a short background/resume cycle', async () => {
    client.subscribe('nativeChat.subscribe', {}, vi.fn())
    await Promise.resolve()
    fixture.pools[0]!.lose({ status: 429, retryAfterMs: 30_000 })
    AppState.currentState = 'background'
    fixture.appStateListener?.('background')
    await vi.advanceTimersByTimeAsync(1000)
    AppState.currentState = 'active'
    fixture.appStateListener?.('active')
    await vi.advanceTimersByTimeAsync(28_999)
    expect(fixture.pools).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fixture.pools).toHaveLength(2)
  })

  it('probes a healthy subscription on focus without replacing its connection', async () => {
    client.subscribe('nativeChat.subscribe', {}, vi.fn())
    await Promise.resolve()
    client.notifyForeground('focus')
    await Promise.resolve()
    client.notifyForeground('focus')
    expect(fixture.probe).toHaveBeenCalledTimes(1)
    expect(fixture.probe).toHaveBeenCalledWith('status.get', undefined, { timeoutMs: 8000 })
    expect(fixture.pools).toHaveLength(1)
    expect(fixture.pools[0]!.close).not.toHaveBeenCalled()
  })

  it('recovers a silent half-open subscription without a socket close event', async () => {
    fixture.probe.mockImplementation(() => new Promise(() => {}))
    client.subscribe('nativeChat.subscribe', {}, vi.fn())
    await Promise.resolve()
    const pool = fixture.pools[0]!
    await vi.advanceTimersByTimeAsync(43_999)
    expect(pool.subscriptions).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(501)
    expect(pool.subscriptions).toHaveLength(2)
    expect(pool.close).not.toHaveBeenCalled()
  })

  it('authenticated stream traffic avoids idle probes and disposal stops all health timers', async () => {
    const release = client.subscribe('nativeChat.subscribe', {}, vi.fn())
    await Promise.resolve()
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(10_000)
      fixture.pools[0]!.subscriptions[0]!.callbacks.onResponse({
        id: 'event',
        ok: true,
        result: {}
      })
    }
    expect(fixture.probe).not.toHaveBeenCalled()
    release()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([...READY_STREAM_RELEASE_METHODS.keys()])(
    'closes only the account-owned %s channel once',
    async (method) => {
      const listener = vi.fn()
      const release = client.subscribe(method, {}, listener)
      await Promise.resolve()
      const pool = fixture.pools[0]!
      const stream = pool.subscriptions[0]!
      stream.callbacks.onResponse({
        id: 'ready',
        ok: true,
        result: { type: 'ready', subscriptionId: 'owned' }
      })
      release()
      release()
      stream.callbacks.onClose?.()
      expect(stream.close).toHaveBeenCalledTimes(1)
      expect(pool.close).not.toHaveBeenCalled()
      expect(fixture.probe).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('closes a late-opened account channel and never delivers after disposal', async () => {
    let open!: () => void
    fixture.subscriptionGate = new Promise<void>((resolve) => {
      open = resolve
    })
    const listener = vi.fn()
    const release = client.subscribe('notifications.subscribe', {}, listener)
    const stream = fixture.pools[0]!.subscriptions[0]!
    release()
    stream.callbacks.onResponse({
      id: 'late',
      ok: true,
      result: { type: 'ready', subscriptionId: 'late' }
    })
    open()
    await Promise.resolve()
    await Promise.resolve()
    expect(stream.close).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['end', 'refusal'])(
    'retires an account stream on %s without stale callbacks or retries',
    async (kind) => {
      const listener = vi.fn()
      const release = client.subscribe('nativeChat.subscribe', {}, listener)
      await Promise.resolve()
      const pool = fixture.pools[0]!
      const stream = pool.subscriptions[0]!
      stream.callbacks.onResponse(
        kind === 'end'
          ? { id: 'done', ok: true, result: { type: 'end' } }
          : { id: 'done', ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } }
      )
      stream.callbacks.onResponse({ id: 'late', ok: true, result: 'stale' })
      stream.callbacks.onClose?.()
      release()
      await vi.runOnlyPendingTimersAsync()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(
        kind === 'end'
          ? { type: 'end' }
          : expect.objectContaining({ type: 'error', message: 'Access denied' })
      )
      expect(stream.close).toHaveBeenCalledTimes(1)
      expect(pool.close).not.toHaveBeenCalled()
      expect(pool.subscriptions).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    }
  )
})
