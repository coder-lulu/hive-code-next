import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { ConnectionState, HostProfile } from './types'

const context = vi.hoisted(() => ({
  primeHosts: vi.fn(),
  forceReconnect: vi.fn(async () => {}),
  getAllClients: vi.fn()
}))
vi.mock('./rpc-client-context-contract', () => ({ useRpcClientContext: () => context }))
import { useEnsureHostConnected } from './host-client-hooks'

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it.each([true, false])(
  'bounds the connection wait for account=%s without abandoning a valid handshake',
  async (account) => {
    vi.useFakeTimers()
    const listeners = new Set<(state: ConnectionState) => void>()
    context.getAllClients.mockReturnValue([
      {
        hostId: 'host',
        client: {
          getState: () => 'connecting',
          onStateChange: (listener: (state: ConnectionState) => void) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          }
        }
      }
    ])
    let ensure!: ReturnType<typeof useEnsureHostConnected>
    function Harness() {
      ensure = useEnsureHostConnected()
      return null
    }
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    const host = {
      id: 'host',
      ...(account ? { accountRuntime: { runtimeRecordId: 'runtime' } } : {})
    } as HostProfile
    let result: boolean | undefined
    const pending = ensure(host).then((connected) => {
      result = connected
    })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(result).toBe(account ? undefined : false)
    for (const listener of listeners) {
      listener('connected')
    }
    await pending
    expect(result).toBe(account)
    expect(listeners.size).toBe(0)
    await act(async () => renderer.unmount())
  }
)
