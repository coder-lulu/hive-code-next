import { describe, expect, it, vi } from 'vitest'
import { MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY } from '../../../src/shared/mobile-desktop-relay-contract'
import {
  reachableServerClients,
  relaysToServers,
  scopeRpcClientToExecutionHost,
  workspaceRouteExecutionHost
} from './execution-host-scoped-rpc-client'
import type { RpcClient } from './rpc-client'
import { directWire, directWireRegistry, directWireTracker } from './direct-rpc-wire-test-harness'
import type { RpcResponse } from './types'

const SERVER = 'runtime:env-1' as const

describe('executionHost on the direct envelope', () => {
  it('keeps local and server terminal streams isolated even with identical params', () => {
    const socket = directWire()
    const streams = directWireRegistry(socket)
    const params = { terminal: 't1', client: { id: 'phone', type: 'mobile' } }
    const disposeServer = streams.subscribe('terminal.subscribe', params, () => {}, {
      envelope: { executionHost: SERVER }
    })
    const disposeLocal = streams.subscribe('terminal.subscribe', params, () => {})
    disposeServer()
    expect(socket.frames().map((frame) => [frame.method, frame.executionHost])).toEqual([
      ['terminal.subscribe', SERVER],
      ['terminal.subscribe', undefined],
      ['terminal.unsubscribe', SERVER]
    ])
    disposeLocal()
    expect(socket.frames().at(-1)).toMatchObject({
      method: 'terminal.unsubscribe',
      params: { requestId: 'rpc-2' }
    })
    expect(socket.frames().at(-1)).not.toHaveProperty('executionHost')
  })
  it('preserves each owning envelope regardless of key order', () => {
    const socket = directWire()
    const streams = directWireRegistry(socket)
    const params = { terminal: 't1', client: { id: 'phone', type: 'mobile' } }
    const older = streams.subscribe('terminal.subscribe', params, () => {}, {
      envelope: { executionHost: SERVER, trace: 't' }
    })
    const newer = streams.subscribe('terminal.subscribe', params, () => {}, {
      envelope: { trace: 't', executionHost: SERVER }
    })
    older()
    newer()
    expect(socket.frames().slice(2)).toEqual([
      expect.objectContaining({
        method: 'terminal.unsubscribe',
        executionHost: SERVER,
        trace: 't',
        params: expect.objectContaining({ requestId: 'rpc-1' })
      }),
      expect.objectContaining({
        method: 'terminal.unsubscribe',
        executionHost: SERVER,
        trace: 't',
        params: expect.objectContaining({ requestId: 'rpc-2' })
      })
    ])
  })
})

describe('a server workspace call on the direct wire', () => {
  it('reaches the desktop as the same top-level executionHost frame as before the envelope', async () => {
    const socket = directWire()
    const requests = directWireTracker(socket)
    const streams = directWireRegistry(socket)
    const direct: RpcClient = {
      ...fakeClient(),
      sendRequest: (method, params, options) => requests.sendRequest(method, params, options),
      subscribe: (method, params, onData, options) =>
        streams.subscribe(method, params, onData, options)
    }
    const server = scopeRpcClientToExecutionHost(direct, SERVER)
    const request = server.sendRequest('worktree.ps', { limit: 1 })
    let dispose: (() => void) | undefined
    try {
      await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
      dispose = server.subscribe('terminal.subscribe', { terminal: 't1' }, () => {})
      // Compare parsed wire frames; desktop dispatch ignores JSON key order.
      expect(socket.frames()).toStrictEqual([
        JSON.parse(
          '{"id":"rpc-1","deviceToken":"device-token","method":"worktree.ps","params":{"limit":1},"executionHost":"runtime:env-1"}'
        ),
        JSON.parse(
          '{"id":"rpc-2","deviceToken":"device-token","method":"terminal.subscribe","params":{"terminal":"t1"},"executionHost":"runtime:env-1"}'
        )
      ])
      const reply: RpcResponse = { id: 'rpc-1', ok: true, result: { worktrees: [] } }
      expect(requests.resolve(reply)).toBe(true)
      await expect(request).resolves.toBe(reply)
    } finally {
      dispose?.()
      requests.rejectAll('test cleanup')
      await request.catch(() => {})
    }
  })
})

function fakeClient(carries?: boolean) {
  const sendRequest = vi.fn(async (): Promise<RpcResponse> => ({
    id: 'reply',
    ok: true,
    result: null
  }))
  const subscribe = vi.fn(() => () => {})
  const close = vi.fn()
  const client = {
    sendRequest,
    subscribe,
    close,
    updateTerminalSubscriptionViewport: vi.fn(),
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    onStateChange: () => () => {},
    notifyForeground: vi.fn(),
    ...(carries === undefined ? {} : { carriesRpcEnvelope: () => carries })
  } satisfies RpcClient
  return client
}

describe('scopeRpcClientToExecutionHost', () => {
  it('runs every request and stream on the host, as one stable view that owns no connection', () => {
    const client = fakeClient()
    const view = scopeRpcClientToExecutionHost(client, SERVER)
    void view.sendRequest('worktree.ps', { limit: 1 }, { timeoutMs: 5, envelope: { trace: 't' } })
    const onBinaryFrame = vi.fn()
    view.subscribe('terminal.subscribe', { terminal: 't1' }, () => {}, {
      onBinaryFrame,
      envelope: { trace: 'stream', executionHost: 'runtime:wrong' }
    })
    view.close()
    expect(client.sendRequest).toHaveBeenCalledWith(
      'worktree.ps',
      { limit: 1 },
      { timeoutMs: 5, envelope: { trace: 't', executionHost: SERVER } }
    )
    expect(client.subscribe).toHaveBeenCalledWith(
      'terminal.subscribe',
      { terminal: 't1' },
      expect.any(Function),
      { onBinaryFrame, envelope: { trace: 'stream', executionHost: SERVER } }
    )
    expect(client.close).not.toHaveBeenCalled()
    expect(scopeRpcClientToExecutionHost(client, SERVER)).toBe(view)
    expect(scopeRpcClientToExecutionHost(client, 'runtime:env-2')).not.toBe(view)
  })

  it('routes a server workspace only through a relaying desktop over a transport that carries an envelope', () => {
    const relays = [MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY]
    expect(workspaceRouteExecutionHost(fakeClient(), relays, SERVER)).toBe(SERVER)
    expect(workspaceRouteExecutionHost(fakeClient(true), relays, SERVER)).toBe(SERVER)
    expect(workspaceRouteExecutionHost(fakeClient(false), relays, SERVER)).toBeNull()
    expect(workspaceRouteExecutionHost(fakeClient(), [], SERVER)).toBeNull()
    expect(workspaceRouteExecutionHost(null, relays, SERVER)).toBeNull()
    expect(workspaceRouteExecutionHost(fakeClient(), relays, 'local')).toBeUndefined()
    expect(workspaceRouteExecutionHost(fakeClient(), relays, 'ssh:box')).toBeUndefined()
    expect(workspaceRouteExecutionHost(fakeClient(), relays, undefined)).toBeUndefined()
    expect(relaysToServers(scopeRpcClientToExecutionHost(fakeClient(), SERVER), relays)).toBe(true)
    expect(relaysToServers(scopeRpcClientToExecutionHost(fakeClient(false), SERVER), relays)).toBe(
      false
    )
  })

  it('offers only the servers the desktop can relay to now, each as its scoped view', () => {
    const client = fakeClient()
    const relays = [MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY]
    const hosts = [
      { hostId: SERVER, relay: 'ready' },
      { hostId: 'runtime:old', relay: 'update-needed' },
      { hostId: 'runtime:down', relay: 'unavailable' }
    ] as const
    const clients = reachableServerClients(client, relays, hosts)
    expect([...clients.keys()]).toEqual([SERVER])
    expect(clients.get(SERVER)).toBe(scopeRpcClientToExecutionHost(client, SERVER))
    expect(reachableServerClients(client, [], hosts).size).toBe(0)
    expect(reachableServerClients(fakeClient(false), relays, hosts).size).toBe(0)
  })
})
