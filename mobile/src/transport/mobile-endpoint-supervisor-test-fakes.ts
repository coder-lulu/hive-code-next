import { vi } from 'vitest'
import type { SendRequestOptions } from './rpc-client-contract'
import type { RpcClient } from './rpc-client'
import type { ConnectionState, RpcResponse } from './types'

// RPC contract suites retain this import path; no removed Orca relay runtime is restored.
export class FakeSession implements RpcClient {
  readonly sendRequest = vi.fn(
    async (
      _method: string,
      _params?: unknown,
      _options?: SendRequestOptions
    ): Promise<RpcResponse> => ({
      id: 'rpc-1',
      ok: true,
      result: {},
      _meta: { runtimeId: 'runtime-1' }
    })
  )
  readonly subscribe = vi.fn(() => () => {})
  readonly updateTerminalSubscriptionViewport = vi.fn()
  readonly notifyForeground = vi.fn()
  readonly close = vi.fn()
  constructor(private state: ConnectionState) {}
  getState = () => this.state
  getReconnectAttempt = () => 0
  getLastConnectedAt = (): number | null => null
  private readonly listeners = new Set<(state: ConnectionState) => void>()
  onStateChange = vi.fn((listener: (state: ConnectionState) => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  })
  publishState(state: ConnectionState): void {
    this.state = state
    for (const listener of this.listeners) {
      listener(state)
    }
  }
}
