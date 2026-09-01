import { describe, expect, it, vi } from 'vitest'
import type { HiveAccountRuntimeDirectoryState } from '../../shared/hive-runtime-cloud'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import type { RuntimeEnvironmentAccountClaim } from '../../shared/runtime-environments'
import { HiveAccountRuntimeTransport } from './hive-account-runtime-transport'

const runtimeRecordId = '123e4567-e89b-42d3-a456-426614174000'

function claim(resourceVersion = 7, id = runtimeRecordId): RuntimeEnvironmentAccountClaim {
  return {
    runtimeRecordId: id,
    resourceVersion,
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    lastHeartbeatAt: 1,
    freeDiskBytes: 1,
    clientAuthMode: 'IDENTITY_PROOF',
    credentialState: 'ACTIVE',
    connectionCapabilities: ['hive-relay'],
    cloudConnectable: true
  }
}

function readyState(resourceVersion = 7): HiveAccountRuntimeDirectoryState {
  return {
    status: 'READY',
    accountId: '223e4567-e89b-42d3-a456-426614174000',
    sessionGeneration: 1,
    items: [
      {
        runtimeRecordId,
        status: 'CLAIMED',
        runtimeVersion: '1.0.0',
        runtimeProtocolVersion: 3,
        capabilities: [],
        resourceVersion,
        createdAt: 1,
        updatedAt: 1,
        claimedAt: 1,
        presence: 'ONLINE',
        readiness: 'READY',
        readinessReasonCode: null,
        lastHeartbeatAt: 1,
        observedAt: 1,
        freeDiskBytes: 1,
        clientAuthMode: 'IDENTITY_PROOF',
        credentialState: 'ACTIVE',
        connectionCapabilities: ['hive-relay']
      }
    ],
    lastSyncedAt: 1,
    errorCode: null
  }
}

describe('HiveAccountRuntimeTransport', () => {
  it('shares one ticket and socket across concurrent calls for the same revision', async () => {
    let resolveMaterial!: (value: object) => void
    const createConnection = vi.fn(
      () =>
        new Promise<object>((resolve) => {
          resolveMaterial = resolve
        })
    )
    const connection = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({
        id: 'request-1',
        ok: true,
        result: null,
        _meta: { runtimeId: 'runtime-1' }
      }),
      subscribe: vi.fn(),
      close: vi.fn()
    }
    const createRelayConnection = vi.fn(() => connection as never)
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: readyState,
        createConnection: createConnection as never,
        subscribe: (listener) => {
          listener(readyState())
          return () => {}
        }
      },
      { createRelayConnection }
    )

    const first = transport.call(claim(), 'repo.list', undefined)
    const second = transport.call(claim(), 'status.get', undefined)
    expect(createConnection).toHaveBeenCalledOnce()
    resolveMaterial({})
    await Promise.all([first, second])

    expect(createRelayConnection).toHaveBeenCalledOnce()
    expect(connection.request).toHaveBeenCalledTimes(2)
    transport.stop()
  })

  it('does not open a socket when stopped during ticket creation', async () => {
    let resolveMaterial!: (value: object) => void
    const createConnection = vi.fn(
      () =>
        new Promise<object>((resolve) => {
          resolveMaterial = resolve
        })
    )
    const createRelayConnection = vi.fn()
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: readyState,
        createConnection: createConnection as never,
        subscribe: (listener) => {
          listener(readyState())
          return () => {}
        }
      },
      { createRelayConnection }
    )

    const request = transport.call(claim(), 'repo.list', undefined)
    transport.stop()
    resolveMaterial({})

    await expect(request).rejects.toThrow('authorization changed')
    expect(createRelayConnection).not.toHaveBeenCalled()
  })

  it('retires account-only connections immediately on sign-out', async () => {
    let state = readyState()
    const listeners: ((next: HiveAccountRuntimeDirectoryState) => void)[] = []
    const connection = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({
        id: 'request-1',
        ok: true,
        result: { runtimeId: 'runtime-1' },
        _meta: { runtimeId: 'runtime-1' }
      }),
      subscribe: vi.fn(),
      close: vi.fn()
    }
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: () => state,
        createConnection: vi.fn().mockResolvedValue({}),
        subscribe: (next) => {
          listeners.push(next)
          next(state)
          return () => {}
        }
      },
      { createRelayConnection: () => connection as never }
    )

    await transport.call(claim(), 'status.get', undefined)
    state = {
      status: 'SIGNED_OUT',
      accountId: null,
      sessionGeneration: null,
      items: [],
      lastSyncedAt: null,
      errorCode: null
    }
    listeners[0]?.(state)

    expect(connection.close).toHaveBeenCalledOnce()
    transport.stop()
  })

  it('retires cached sockets when the account session generation changes', async () => {
    let state = readyState()
    const listeners: ((next: HiveAccountRuntimeDirectoryState) => void)[] = []
    const connection = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({
        id: 'request-1',
        ok: true,
        result: null,
        _meta: { runtimeId: 'runtime-1' }
      }),
      subscribe: vi.fn(),
      close: vi.fn()
    }
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: () => state,
        createConnection: vi.fn().mockResolvedValue({}),
        subscribe: (next) => {
          listeners.push(next)
          next(state)
          return () => {}
        }
      },
      { createRelayConnection: () => connection as never }
    )

    await transport.call(claim(), 'status.get', undefined)
    state = { ...readyState(), sessionGeneration: 2 }
    listeners[0]?.(state)

    expect(connection.close).toHaveBeenCalledOnce()
    transport.stop()
  })

  it('fences a cached connection when the directory resource version changes', async () => {
    let state = readyState()
    const listeners: ((next: HiveAccountRuntimeDirectoryState) => void)[] = []
    const first = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({
        id: 'request-1',
        ok: true,
        result: null,
        _meta: { runtimeId: 'runtime-1' }
      }),
      subscribe: vi.fn(),
      close: vi.fn()
    }
    const second = { ...first, connect: vi.fn().mockResolvedValue(undefined), close: vi.fn() }
    const createRelayConnection = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: () => state,
        createConnection: vi.fn().mockResolvedValue({}),
        subscribe: (next) => {
          listeners.push(next)
          next(state)
          return () => {}
        }
      },
      { createRelayConnection }
    )

    await transport.call(claim(7), 'repo.list', undefined)
    state = readyState(8)
    listeners[0]?.(state)
    await transport.call(claim(8), 'repo.list', undefined)

    expect(first.close).toHaveBeenCalledOnce()
    expect(createRelayConnection).toHaveBeenCalledTimes(2)
    transport.stop()
  })

  it('retires a cached connection when the Runtime becomes ineligible without a revision change', async () => {
    let state = readyState()
    const listeners: ((next: HiveAccountRuntimeDirectoryState) => void)[] = []
    const connection = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({
        id: 'request-1',
        ok: true,
        result: null,
        _meta: { runtimeId: 'runtime-1' }
      }),
      subscribe: vi.fn(),
      close: vi.fn()
    }
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: () => state,
        createConnection: vi.fn().mockResolvedValue({}),
        subscribe: (next) => {
          listeners.push(next)
          next(state)
          return () => {}
        }
      },
      { createRelayConnection: () => connection as never }
    )

    await transport.call(claim(), 'status.get', undefined)
    state = {
      ...state,
      items: state.items.map((entry) => ({ ...entry, presence: 'OFFLINE' as const }))
    }
    listeners[0]?.(state)

    expect(connection.close).toHaveBeenCalledOnce()
    await expect(transport.call(claim(), 'status.get', undefined)).rejects.toThrow(
      'authorization changed'
    )
    transport.stop()
  })

  it('fails before minting a ticket when the catalog gate is not connectable', async () => {
    const createConnection = vi.fn()
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: readyState,
        createConnection,
        subscribe: (listener) => {
          listener(readyState())
          return () => {}
        }
      },
      { createRelayConnection: vi.fn() }
    )

    await expect(
      transport.call(
        { ...claim(), cloudConnectable: false, presence: 'OFFLINE' },
        'status.get',
        null
      )
    ).rejects.toThrow('offline')
    expect(createConnection).not.toHaveBeenCalled()
    transport.stop()
  })

  it('keeps a healthy shared socket after a request-scoped admission error', async () => {
    const connection = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi
        .fn()
        .mockRejectedValueOnce(
          new RemoteRuntimeClientError('remote_runtime_busy', 'request limit reached')
        )
        .mockResolvedValueOnce({
          id: 'request-2',
          ok: true,
          result: null,
          _meta: { runtimeId: 'runtime-1' }
        }),
      subscribe: vi.fn(),
      close: vi.fn()
    }
    const createRelayConnection = vi.fn(() => connection as never)
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: readyState,
        createConnection: vi.fn().mockResolvedValue({}),
        subscribe: (listener) => {
          listener(readyState())
          return () => {}
        }
      },
      { createRelayConnection }
    )

    await expect(transport.call(claim(), 'repo.list', undefined)).rejects.toMatchObject({
      code: 'remote_runtime_busy'
    })
    await expect(transport.call(claim(), 'status.get', undefined)).resolves.toMatchObject({
      ok: true
    })

    expect(createRelayConnection).toHaveBeenCalledOnce()
    expect(connection.close).not.toHaveBeenCalled()
    transport.stop()
  })

  it('fences active subscriptions when ownership revision changes', async () => {
    let state = readyState()
    const listeners: ((next: HiveAccountRuntimeDirectoryState) => void)[] = []
    const connection = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn(),
      subscribe: vi.fn().mockReturnValue({
        requestId: 'subscription-1',
        close: vi.fn(),
        sendBinary: vi.fn(),
        sendRequest: vi.fn()
      }),
      close: vi.fn()
    }
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: () => state,
        createConnection: vi.fn().mockResolvedValue({}),
        subscribe: (next) => {
          listeners.push(next)
          next(state)
          return () => {}
        }
      },
      { createRelayConnection: () => connection as never }
    )

    await transport.subscribe(claim(), 'terminal.subscribe', {}, undefined, {
      onResponse: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn()
    })
    state = readyState(8)
    listeners[0]?.(state)

    expect(connection.close).toHaveBeenCalledOnce()
    transport.stop()
  })

  it('disconnects both request and subscription sockets for one Runtime', async () => {
    const requestConnection = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({
        id: 'request-1',
        ok: true,
        result: null,
        _meta: { runtimeId: 'runtime-1' }
      }),
      subscribe: vi.fn(),
      close: vi.fn()
    }
    const subscriptionConnection = {
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn(),
      subscribe: vi.fn().mockReturnValue({
        requestId: 'subscription-1',
        close: vi.fn(),
        sendBinary: vi.fn(),
        sendRequest: vi.fn()
      }),
      close: vi.fn()
    }
    const createRelayConnection = vi
      .fn()
      .mockReturnValueOnce(requestConnection)
      .mockReturnValueOnce(subscriptionConnection)
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: readyState,
        createConnection: vi.fn().mockResolvedValue({}),
        subscribe: (listener) => {
          listener(readyState())
          return () => {}
        }
      },
      { createRelayConnection }
    )

    await transport.call(claim(), 'status.get', undefined)
    await transport.subscribe(claim(), 'terminal.subscribe', {}, undefined, {
      onResponse: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn()
    })

    transport.disconnect(runtimeRecordId)

    expect(requestConnection.close).toHaveBeenCalledOnce()
    expect(subscriptionConnection.close).toHaveBeenCalledOnce()
    transport.stop()
  })

  it('bounds cached fleet sockets and evicts the least recently used Runtime', async () => {
    const runtimeIds = [
      '123e4567-e89b-42d3-a456-426614174001',
      '123e4567-e89b-42d3-a456-426614174002',
      '123e4567-e89b-42d3-a456-426614174003'
    ]
    const baseState = readyState()
    const state: HiveAccountRuntimeDirectoryState = {
      ...baseState,
      items: runtimeIds.map((id) => ({ ...baseState.items[0]!, runtimeRecordId: id }))
    }
    const connections = runtimeIds.map((id) => ({
      id,
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue({
        id: `request-${id}`,
        ok: true,
        result: null,
        _meta: { runtimeId: id }
      }),
      subscribe: vi.fn(),
      close: vi.fn()
    }))
    const createRelayConnection = vi
      .fn()
      .mockReturnValueOnce(connections[0])
      .mockReturnValueOnce(connections[1])
      .mockReturnValueOnce(connections[2])
    const transport = new HiveAccountRuntimeTransport(
      {
        getState: () => state,
        createConnection: vi.fn().mockResolvedValue({}),
        subscribe: (listener) => {
          listener(state)
          return () => {}
        }
      },
      { createRelayConnection, maxCachedRequestConnections: 2 }
    )

    await transport.call(claim(7, runtimeIds[0]), 'status.get', undefined)
    await transport.call(claim(7, runtimeIds[1]), 'status.get', undefined)
    await transport.call(claim(7, runtimeIds[0]), 'status.get', undefined)
    await transport.call(claim(7, runtimeIds[2]), 'status.get', undefined)

    expect(connections[0]!.close).not.toHaveBeenCalled()
    expect(connections[1]!.close).toHaveBeenCalledOnce()
    expect(connections[2]!.close).not.toHaveBeenCalled()
    transport.stop()
  })
})
