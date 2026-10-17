import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from './rpc-client'
import { directWire, directWireRegistry, directWireTracker } from './direct-rpc-wire-test-harness'
import type { RpcResponse } from './types'

const SERVER = 'runtime:env-1' as const

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
    void direct.sendRequest('worktree.ps', { limit: 1 }, { envelope: { executionHost: SERVER } })
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    direct.subscribe('terminal.subscribe', { terminal: 't1' }, () => {}, {
      envelope: { executionHost: SERVER }
    })
    // What #26501 wrote with its own `executionHost` option; the desktop parses JSON, so key order is not read.
    expect(socket.frames()).toStrictEqual([
      JSON.parse(
        '{"id":"rpc-1","deviceToken":"device-token","method":"worktree.ps","params":{"limit":1},"executionHost":"runtime:env-1"}'
      ),
      JSON.parse(
        '{"id":"rpc-2","deviceToken":"device-token","method":"terminal.subscribe","params":{"terminal":"t1"},"executionHost":"runtime:env-1"}'
      )
    ])
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
