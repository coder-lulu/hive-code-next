import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { StableLogicalRpcClient } from '../transport/stable-logical-rpc-client'
import type {
  AccountRuntimeConnectionMaterial,
  AccountRuntimeRoute,
  ConnectionState
} from '../transport/types'

vi.mock('./account-runtime-rpc-session', () => ({
  connectAccountRuntimeRpcSession: vi.fn()
}))

import { AccountRuntimeConnectionLifecycle } from './account-runtime-connection-lifecycle'

const connection: AccountRuntimeConnectionMaterial = {
  connectionIntentId: 'intent-1',
  ticketId: 'ticket-1',
  ticketSecret: 'secret-1',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  runtimePublicKeyB64: 'CQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  clientKeyPair: {
    publicKey: new Uint8Array(32).fill(1),
    secretKey: new Uint8Array(32).fill(2)
  },
  relay: {
    cellUrl: 'https://relay.example.com',
    relayHostId: 'AbCdEf0123_-xyZ9',
    assignmentEpoch: 1
  }
}

function createLogical(initialState: ConnectionState) {
  let state = initialState
  let generation = 1
  const listeners = new Set<(state: ConnectionState) => void>()
  const migrateTo = vi.fn(async () => {
    generation += 1
    state = 'connected'
    for (const listener of listeners) {
      listener(state)
    }
  })
  const logical = {
    getState: () => state,
    getGeneration: () => generation,
    onStateChange(listener: (next: ConnectionState) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    migrateTo
  } as unknown as StableLogicalRpcClient
  return {
    logical,
    migrateTo,
    publish(next: ConnectionState) {
      state = next
      for (const listener of listeners) {
        listener(next)
      }
    }
  }
}

function createRoute(createConnection = vi.fn(async () => connection)): AccountRuntimeRoute {
  return {
    runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    resourceVersion: 4,
    createConnection
  }
}

describe('AccountRuntimeConnectionLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not mint an account intent when the local route connects during its grace period', async () => {
    const local = createLogical('connecting')
    const createConnection = vi.fn(async () => connection)
    const lifecycle = new AccountRuntimeConnectionLifecycle(
      local.logical,
      createRoute(createConnection),
      'local-fallback',
      vi.fn(),
      {
        connect: vi.fn(() => ({}) as RpcClient),
        setTimer: setTimeout,
        clearTimer: clearTimeout
      }
    )

    lifecycle.start()
    await vi.advanceTimersByTimeAsync(2_000)
    local.publish('connected')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(createConnection).not.toHaveBeenCalled()
    expect(local.migrateTo).not.toHaveBeenCalled()
    lifecycle.stop()
  })

  it('mints a fresh intent and migrates an account-only client after disconnect', async () => {
    const account = createLogical('disconnected')
    const createConnection = vi.fn(async () => connection)
    const physical = {} as RpcClient
    const connect = vi.fn(() => physical)
    const lifecycle = new AccountRuntimeConnectionLifecycle(
      account.logical,
      createRoute(createConnection),
      'account-only',
      vi.fn(),
      { connect, setTimer: setTimeout, clearTimer: clearTimeout }
    )

    lifecycle.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(createConnection).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledWith({ connection, onLog: expect.any(Function) })
    expect(account.migrateTo).toHaveBeenCalledWith(physical, 'relay', 12_000, expect.any(Function))
    lifecycle.stop()
  })

  it('does not migrate a late intent after the lifecycle has stopped', async () => {
    let resolveConnection!: (value: AccountRuntimeConnectionMaterial) => void
    let intentSignal: AbortSignal | undefined
    const pendingConnection = new Promise<AccountRuntimeConnectionMaterial>((resolve) => {
      resolveConnection = resolve
    })
    const account = createLogical('disconnected')
    const lifecycle = new AccountRuntimeConnectionLifecycle(
      account.logical,
      createRoute(
        vi.fn((signal?: AbortSignal) => {
          intentSignal = signal
          return pendingConnection
        })
      ),
      'account-only',
      vi.fn(),
      {
        connect: vi.fn(() => ({}) as RpcClient),
        setTimer: setTimeout,
        clearTimer: clearTimeout
      }
    )

    lifecycle.start()
    await vi.advanceTimersByTimeAsync(0)
    lifecycle.stop()
    expect(intentSignal?.aborted).toBe(true)
    resolveConnection(connection)
    await Promise.resolve()
    await Promise.resolve()

    expect(account.migrateTo).not.toHaveBeenCalled()
  })

  it('aborts a backgrounded intent and never lets its late result replace a foreground retry', async () => {
    let resolveStale!: (value: AccountRuntimeConnectionMaterial) => void
    let staleSignal: AbortSignal | undefined
    const staleConnection = new Promise<AccountRuntimeConnectionMaterial>((resolve) => {
      resolveStale = resolve
    })
    const freshConnection = { ...connection, connectionIntentId: 'intent-2' }
    const createConnection = vi
      .fn<(signal?: AbortSignal) => Promise<AccountRuntimeConnectionMaterial>>()
      .mockImplementationOnce((signal) => {
        staleSignal = signal
        return staleConnection
      })
      .mockResolvedValueOnce(freshConnection)
    const account = createLogical('disconnected')
    const connect = vi.fn(() => ({}) as RpcClient)
    const lifecycle = new AccountRuntimeConnectionLifecycle(
      account.logical,
      createRoute(createConnection),
      'account-only',
      vi.fn(),
      { connect, setTimer: setTimeout, clearTimer: clearTimeout }
    )

    lifecycle.start()
    await vi.advanceTimersByTimeAsync(0)
    lifecycle.setForeground(false)
    expect(staleSignal?.aborted).toBe(true)
    lifecycle.setForeground(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(createConnection).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenCalledWith({
      connection: freshConnection,
      onLog: expect.any(Function)
    })
    resolveStale(connection)
    await Promise.resolve()
    await Promise.resolve()

    expect(connect).toHaveBeenCalledTimes(1)
    lifecycle.stop()
  })

  it('does not let an aborted intent failure close a newer foreground dial', async () => {
    let rejectStale!: (error: Error) => void
    const staleConnection = new Promise<AccountRuntimeConnectionMaterial>((_resolve, reject) => {
      rejectStale = reject
    })
    const createConnection = vi
      .fn<(signal?: AbortSignal) => Promise<AccountRuntimeConnectionMaterial>>()
      .mockReturnValueOnce(staleConnection)
      .mockResolvedValueOnce(connection)
    const account = createLogical('disconnected')
    let rejectFreshMigration!: (error: Error) => void
    account.migrateTo.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFreshMigration = reject
        })
    )
    const close = vi.fn(() => rejectFreshMigration(new Error('dial cancelled')))
    const physical = { close } as unknown as RpcClient
    const lifecycle = new AccountRuntimeConnectionLifecycle(
      account.logical,
      createRoute(createConnection),
      'account-only',
      vi.fn(),
      {
        connect: vi.fn(() => physical),
        setTimer: setTimeout,
        clearTimer: clearTimeout
      }
    )

    lifecycle.start()
    await vi.advanceTimersByTimeAsync(0)
    lifecycle.setForeground(false)
    lifecycle.setForeground(true)
    await vi.advanceTimersByTimeAsync(0)
    rejectStale(new Error('aborted intent settled late'))
    await Promise.resolve()
    await Promise.resolve()

    expect(close).not.toHaveBeenCalled()
    lifecycle.stop()
  })

  it('closes a replacement physical session that is still dialing when stopped', async () => {
    const account = createLogical('disconnected')
    let rejectMigration!: (error: Error) => void
    account.migrateTo.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectMigration = reject
        })
    )
    const close = vi.fn(() => rejectMigration(new Error('dial cancelled')))
    const physical = { close } as unknown as RpcClient
    const lifecycle = new AccountRuntimeConnectionLifecycle(
      account.logical,
      createRoute(),
      'account-only',
      vi.fn(),
      {
        connect: vi.fn(() => physical),
        setTimer: setTimeout,
        clearTimer: clearTimeout
      }
    )

    lifecycle.start()
    await vi.advanceTimersByTimeAsync(0)
    lifecycle.stop()
    await Promise.resolve()
    await Promise.resolve()

    expect(close).toHaveBeenCalledOnce()
  })

  it('closes a replacement physical session that is still dialing when backgrounded', async () => {
    const account = createLogical('disconnected')
    let rejectMigration!: (error: Error) => void
    account.migrateTo.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectMigration = reject
        })
    )
    const close = vi.fn(() => rejectMigration(new Error('dial cancelled')))
    const physical = { close } as unknown as RpcClient
    const lifecycle = new AccountRuntimeConnectionLifecycle(
      account.logical,
      createRoute(),
      'account-only',
      vi.fn(),
      {
        connect: vi.fn(() => physical),
        setTimer: setTimeout,
        clearTimer: clearTimeout
      }
    )

    lifecycle.start()
    await vi.advanceTimersByTimeAsync(0)
    lifecycle.setForeground(false)
    await Promise.resolve()
    await Promise.resolve()

    expect(close).toHaveBeenCalledOnce()
    lifecycle.stop()
  })
})
