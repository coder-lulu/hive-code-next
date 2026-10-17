import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

const route = vi.hoisted(() => ({ params: {} as Record<string, string>, mounted: 0 }))
vi.mock('expo-router', () => ({ useLocalSearchParams: () => route.params }))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: null, state: 'connected' })
}))
vi.mock('../components/host-protocol-gates-context', async () => {
  const { createContext } = await import('react')
  return {
    HostStatusGatesContext: createContext(null),
    useOptionalHostProtocolGates: () => ({ hostCapabilities: [], statusPending: false })
  }
})
vi.mock('../mobile-web-shell/PageRouteUnavailableScreen', () => ({
  PageRouteUnavailableScreen: 'Unavailable'
}))
import { WorkspaceRoute } from './workspace-route'

function Child() {
  route.mounted++
  return null
}

describe('workspace execution authority', () => {
  it.each([undefined, 'local', 'ssh:box'])(
    'keeps the directly selected account host with %s',
    async (executionHost) => {
      route.params = { hostId: 'account-runtime-1', ...(executionHost ? { executionHost } : {}) }
      route.mounted = 0
      await act(async () => {
        create(createElement(WorkspaceRoute, null, createElement(Child)))
      })
      expect(route.mounted).toBeGreaterThan(0)
    }
  )

  it('refuses delegated runtime links before a workspace can send requests', async () => {
    route.params = { hostId: 'account-runtime-1', executionHost: 'runtime:other' }
    route.mounted = 0
    await act(async () => {
      create(createElement(WorkspaceRoute, null, createElement(Child)))
    })
    expect(route.mounted).toBe(0)
  })
})
