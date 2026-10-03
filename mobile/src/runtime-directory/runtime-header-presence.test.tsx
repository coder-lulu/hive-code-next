import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { HostCatalogEntry } from '../transport/types'
import { HostScreenHeader } from '../host-screen/host-screen-header'
import { MobileTasksHeader } from '../tasks/MobileTasksHeader'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({
  Bot: 'Icon',
  ChevronDown: 'Icon',
  ChevronLeft: 'Icon',
  CircleAlert: 'Icon',
  Filter: 'Icon',
  FolderKanban: 'Icon',
  Layers: 'Icon',
  List: 'Icon',
  PanelLeftClose: 'Icon',
  Plus: 'Icon',
  RefreshCw: 'Icon',
  Search: 'Icon',
  SlidersHorizontal: 'Icon',
  SquareTerminal: 'Icon',
  UserCircle: 'Icon',
  X: 'Icon'
}))
vi.mock('expo-router', () => ({ useRouter: () => ({}) }))
vi.mock('../components/MobileSearchField', () => ({ MobileSearchField: () => null }))
vi.mock('./MobileRuntimeSelector', () => ({ MobileRuntimeSelector: () => null }))
vi.mock('../transport/use-all-host-clients', () => ({ useAllHostClients: () => [] }))
vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: (factory: (theme: typeof lightTheme) => unknown) => factory(lightTheme)
  }
})
vi.mock('./use-account-visible-host-catalog', () => ({
  useAccountVisibleHostCatalog: () => ({ catalog })
}))

let catalog: HostCatalogEntry[] = []
let tree: ReactTestRenderer | undefined
afterEach(() => {
  act(() => tree?.unmount())
})

function header(screen: 'workspace' | 'tasks', hostId: string) {
  if (screen === 'tasks') {
    return createElement(MobileTasksHeader, {
      hostId,
      connectionState: 'disconnected',
      busy: false,
      onCreate: () => {},
      onRefresh: () => {},
      onRuntimeSelectorVisibleChange: () => {},
      runtimeSelectorVisible: false,
      showCreateTask: true,
      taskUiReady: false
    })
  }
  const fields = {
    hostId,
    connState: 'disconnected',
    embedded: false,
    displayWorktrees: [],
    now: 0,
    runtimeCatalog: catalog,
    settings: { activeFilterCount: 0 },
    state: { hostName: hostId, search: '', setSearch: () => {}, setShowRuntimeSelector: () => {} }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only phone-header fields are read in this fixture.
  const controller = fields as unknown as Parameters<typeof HostScreenHeader>[0]['controller']
  return createElement(HostScreenHeader, { controller })
}

it.each(['workspace', 'tasks'] as const)(
  '%s follows the selected host presence as it changes',
  (screen) => {
    const host: HostCatalogEntry = {
      id: 'desktop',
      name: 'desktop',
      endpoint: 'ws://desktop',
      lastConnected: 0,
      publicKeyB64: 'key',
      profile: null,
      credentialStatus: 'ready',
      accessSources: ['account-claimed'],
      accountPresence: 'ONLINE'
    }
    catalog = [host]
    act(() => {
      tree = create(header(screen, host.id))
    })
    const labels = () =>
      tree?.root.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children)
    expect(labels()).toContain('在线')
    expect(labels()).not.toContain('离线')
    expect(
      tree?.root
        .findAll((node) => String(node.type) === 'Pressable')
        .map((node) => node.props.accessibilityLabel)
    ).toContain('选择 Runtime，当前为 desktop，主机在线，尚未建立连接')
    // Another online host must not mask the selected host going offline.
    catalog = [
      { ...host, id: 'other' },
      { ...host, accountPresence: 'OFFLINE', credentialStatus: 'cloud-offline' }
    ]
    act(() => {
      tree?.update(header(screen, host.id))
    })
    expect(labels()).toContain('离线')
    expect(labels()).not.toContain('在线')
  }
)
