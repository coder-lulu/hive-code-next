import { beforeEach, expect, it, vi } from 'vitest'
const fixtures = vi.hoisted(() => ({
  connect: vi.fn(),
  failure: null as unknown,
  app: { currentState: 'active', addEventListener: vi.fn() },
  pools: [] as FakePool[]
}))
type PoolOptions = { onStateChange(state: string): void }
type FakePool = {
  options: PoolOptions
  connect: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  request: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
}
vi.mock('react-native', () => ({ AppState: fixtures.app }))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7)
}))
vi.mock('./rpc-client', () => ({ connect: fixtures.connect }))
vi.mock('../../../src/shared/hive-account-relay-pool', () => ({
  HiveAccountRelayPool: class {
    options: PoolOptions
    connect = vi.fn(async () => {
      if (fixtures.failure) {
        throw fixtures.failure
      }
      this.options.onStateChange('ready')
    })
    getState = () => 'ready'
    close = vi.fn()
    request = vi.fn(async () => ({
      id: '1',
      ok: true,
      result: 'ok',
      _meta: { runtimeId: 'runtime' }
    }))
    subscribe = vi.fn(async () => ({ close: vi.fn(), sendBinary: vi.fn() }))
    constructor(options: PoolOptions) {
      this.options = options
      fixtures.pools.push(this)
    }
  }
}))
import { openHostLogicalClient } from './host-logical-client'
import { HiveAccountRelayClosedError } from '../../../src/shared/hive-account-relay-errors'
import {
  listAccountRuntimeClients,
  resetAccountRuntimeClientRegistryForTests
} from '../runtime-directory/account-runtime-client-registry'

const host = {
  id: 'runtime',
  accountRuntime: { runtimeRecordId: 'runtime', resourceVersion: 1, createConnection: vi.fn() }
}
beforeEach(() => {
  fixtures.pools.length = 0
  fixtures.failure = null
  fixtures.app.currentState = 'active'
  fixtures.app.addEventListener.mockReset().mockReturnValue({ remove: vi.fn() })
  resetAccountRuntimeClientRegistryForTests()
})

it.each([1002, 1009, 4403, 4426])(
  'stops reconnecting after a terminal Relay close %s',
  async (code) => {
    vi.useFakeTimers()
    fixtures.failure = new HiveAccountRelayClosedError(code)
    const client = await openHostLogicalClient(host as never, vi.fn())
    try {
      await vi.runAllTimersAsync()
      expect(client.getState()).toBe('auth-failed')
      client.notifyForeground('network-change')
      await vi.runAllTimersAsync()
      expect(fixtures.pools).toHaveLength(1)
    } finally {
      client.close()
      vi.useRealTimers()
    }
  }
)

it('honors Cloud Retry-After before creating another connection', async () => {
  vi.useFakeTimers()
  fixtures.failure = { status: 429, retryAfterMs: 60_000 }
  const client = await openHostLogicalClient(host as never, vi.fn())
  try {
    await vi.advanceTimersByTimeAsync(59_999)
    expect(fixtures.pools).toHaveLength(1)
    fixtures.failure = null
    await vi.advanceTimersByTimeAsync(1)
    expect(fixtures.pools).toHaveLength(2)
  } finally {
    client.close()
    vi.useRealTimers()
  }
})

it('uses the shared authenticated account pool and releases its account registration', async () => {
  const client = await openHostLogicalClient(host as never, vi.fn())
  await expect(client.sendRequest('runtime.status')).resolves.toMatchObject({ ok: true })
  expect(fixtures.connect).not.toHaveBeenCalled()
  expect(fixtures.pools).toHaveLength(1)
  expect(listAccountRuntimeClients()).toHaveLength(1)
  client.close()
  expect(fixtures.pools[0]!.close).toHaveBeenCalledOnce()
  expect(listAccountRuntimeClients()).toEqual([])
})

it('discards the pool in background and creates fresh material routes on foreground', async () => {
  const client = await openHostLogicalClient(host as never, vi.fn())
  const onAppState = fixtures.app.addEventListener.mock.calls[0]![1]
  fixtures.app.currentState = 'background'
  onAppState('background')
  expect(fixtures.pools[0]!.close).toHaveBeenCalledOnce()
  await expect(client.sendRequest('terminal.write')).rejects.toThrow('inactive')
  fixtures.app.currentState = 'active'
  onAppState('active')
  expect(fixtures.pools).toHaveLength(2)
  client.close()
  onAppState('active')
  expect(fixtures.pools).toHaveLength(2)
})

it('closes a subscription that finishes acquiring after its consumer has cancelled', async () => {
  const client = await openHostLogicalClient(host as never, vi.fn())
  let resolve!: (value: { close(): void }) => void
  fixtures.pools[0]!.subscribe.mockImplementation(
    () =>
      new Promise((settle) => {
        resolve = settle
      })
  )
  const unsubscribe = client.subscribe('terminal.subscribe', {}, vi.fn())
  unsubscribe()
  const close = vi.fn()
  resolve({ close })
  await Promise.resolve()
  expect(close).toHaveBeenCalledOnce()
  client.close()
})
