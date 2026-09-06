import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountRelayCallbacks } from '../../../src/shared/hive-account-relay-pool-contract'

const fixture = vi.hoisted(() => ({
  connectError: null as unknown,
  pools: [] as Array<{
    close: ReturnType<typeof vi.fn>
    subscriptions: Array<{ method: string; callbacks: HiveAccountRelayCallbacks }>
  }>
}))

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) }
}))
vi.mock('./runtime-random', () => ({ mobileRuntimeRandomBytes: vi.fn() }))
vi.mock('../../../src/shared/hive-account-relay-pool', () => ({
  HiveAccountRelayPool: class {
    subscriptions: Array<{ method: string; callbacks: HiveAccountRelayCallbacks }> = []
    close = vi.fn()
    constructor(private options: { onStateChange: (state: string) => void }) {
      fixture.pools.push(this)
    }
    async connect() {
      if (fixture.connectError) {
        throw fixture.connectError
      }
      this.options.onStateChange('ready')
    }
    getState() {
      return 'ready'
    }
    getLastError() {
      return new Error('Temporary stream failure')
    }
    async subscribe(method: string, _params: unknown, callbacks: HiveAccountRelayCallbacks) {
      this.subscriptions.push({ method, callbacks })
      return { close: vi.fn() }
    }
    async request() {
      return { id: 'request', ok: true, result: {}, _meta: { runtimeId: 'host' } }
    }
  }
}))

import { AccountRuntimeRpcClient } from './account-runtime-rpc-client'

describe('account Runtime independent stream recovery', () => {
  let client: AccountRuntimeRpcClient
  beforeEach(async () => {
    vi.useFakeTimers()
    fixture.pools.length = 0
    fixture.connectError = null
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

  it('bounds failed stream retries without turning a transport failure into pairing failure', async () => {
    const listener = vi.fn()
    client.subscribe('nativeChat.subscribe', {}, listener)
    await Promise.resolve()
    const pool = fixture.pools[0]!
    for (let attempt = 0; attempt < 6; attempt++) {
      pool.subscriptions.at(-1)!.callbacks.onClose?.()
      await vi.runOnlyPendingTimersAsync()
    }
    expect(pool.subscriptions).toHaveLength(6)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
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

  it('bounds repeated revision conflicts without reporting a pairing failure', async () => {
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
    await vi.runAllTimersAsync()
    expect(fixture.pools).toHaveLength(6)
    expect(states).not.toContain('auth-failed')
    expect(client.getState()).toBe('disconnected')
  })
})
