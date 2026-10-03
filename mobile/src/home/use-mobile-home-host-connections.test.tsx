import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { resolveHomeHostConnectionState } from '../transport/home-host-auto-connect'
import type { HostCatalogEntry, HostProfile } from '../transport/types'
import { useMobileHomeHostConnections } from './use-mobile-home-host-connections'

const connection = vi.hoisted(() => {
  const states = new Map<string, string>()
  return {
    states,
    context: { getKnownState: (id: string) => states.get(id) ?? null },
    clients: [],
    acquired: new Array<string[]>(),
    prime: vi.fn()
  }
})

vi.mock('../transport/client-context', () => ({
  usePrimeHosts: () => connection.prime,
  useRpcClientContext: () => connection.context
}))
vi.mock('../transport/use-all-host-clients', () => ({
  useAllHostClients: (_ids: string[], options: { autoConnectHostIds: readonly string[] }) => {
    connection.acquired.push([...options.autoConnectHostIds])
    for (const id of options.autoConnectHostIds) {
      if (!connection.states.has(id)) {
        connection.states.set(id, 'connecting')
      }
    }
    return connection.clients
  }
}))
vi.mock('../components/AccountUsage', () => ({ decodeAccountsSnapshot: vi.fn() }))
vi.mock('../notifications/mobile-notifications', () => ({
  subscribeToDesktopNotifications: vi.fn(() => () => {})
}))

function host(id: string, lastConnected: number): HostProfile {
  return {
    id,
    name: id,
    endpoint: `ws://${id}`,
    deviceToken: `token-${id}`,
    publicKeyB64: `key-${id}`,
    lastConnected
  }
}

it('checks every startup Runtime after earlier attempts settle', () => {
  connection.states.clear()
  connection.acquired.length = 0
  const hosts = [host('a', 5), host('b', 4), host('c', 3), host('d', 2), host('e', 1)]
  const catalog: HostCatalogEntry[] = hosts.map((profile) => ({
    id: profile.id,
    name: profile.name,
    endpoint: profile.endpoint,
    publicKeyB64: profile.publicKeyB64,
    lastConnected: profile.lastConnected,
    credentialStatus: 'ready',
    profile
  }))
  const setters = {
    setStats: vi.fn(),
    setWorktreeInfo: vi.fn(),
    setAccounts: vi.fn(),
    setTaskProviders: vi.fn()
  }
  let pendingHostIds: string[] = []
  function Probe() {
    pendingHostIds = useMobileHomeHostConnections(hosts, catalog, setters).autoConnectHostIds
    return null
  }
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Probe))
  })
  expect(connection.acquired.at(-1)).toEqual(['a', 'b', 'c'])
  expect(pendingHostIds).toEqual(['a', 'b', 'c'])

  connection.states.set('a', 'disconnected')
  connection.clients = []
  act(() => renderer.update(createElement(Probe)))
  expect(connection.acquired.at(-1)).toEqual(['a', 'b', 'c', 'd'])
  expect(pendingHostIds).toEqual(['b', 'c', 'd'])
  expect(resolveHomeHostConnectionState('a', undefined, pendingHostIds)).toBe('disconnected')

  connection.states.set('b', 'reconnecting')
  connection.clients = []
  act(() => renderer.update(createElement(Probe)))
  expect(connection.acquired.at(-1)).toEqual(['a', 'b', 'c', 'd', 'e'])
  expect(pendingHostIds).toEqual(['c', 'd', 'e'])

  connection.states.set('d', 'reconnecting')
  connection.clients = []
  act(() => renderer.update(createElement(Probe)))
  expect(connection.acquired.at(-1)).toEqual(['a', 'b', 'c', 'e'])
  expect(pendingHostIds).toEqual(['c', 'e'])
  act(() => renderer.unmount())
})
