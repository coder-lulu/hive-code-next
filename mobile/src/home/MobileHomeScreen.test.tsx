import { findAllByHostType, findByHostType } from '../test-support/react-test-renderer-host-nodes'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { MobileHomeScreen } from './MobileHomeScreen'
import { MobileHomeProvider } from './MobileHomeProvider'
import { MobileDeviceManagementScreen } from '../devices/MobileDeviceManagementScreen'

const fixture = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  connected: true,
  destination: 'index',
  previousDestination: 'index',
  session: null as { authorityId: string; account: { accountId: string } } | null,
  openSession: vi.fn(),
  reconnect: vi.fn(),
  disconnect: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
  menus: [] as { visible: boolean }[],
  router: { push: vi.fn(), navigate: vi.fn(), back: vi.fn(), setParams: vi.fn() },
  data: {} as Record<string, unknown>
}))
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => fixture.params
}))
vi.mock('lucide-react-native', () => ({
  Home: 'Home',
  Monitor: 'Monitor',
  Activity: 'Icon',
  Edit3: 'Icon',
  PowerOff: 'Icon',
  RefreshCw: 'Icon',
  Trash2: 'Icon',
  Users: 'Icon'
}))
vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  Alert: { alert: vi.fn() },
  StyleSheet: { create: (s: unknown) => s }
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 12 })
}))
vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ hydrated: true, session: fixture.session })
}))
vi.mock('../theme/mobile-theme-provider', () => ({ useMobileTheme: () => lightTheme }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, contentMaxWidth: 600 })
}))
vi.mock('../transport/host-client-hooks', () => ({
  useHostClient: () => ({ client: null, state: fixture.connected ? 'connected' : 'disconnected' }),
  useDisconnectHostClient: () => fixture.disconnect,
  useForgetHostClient: () => vi.fn(),
  useForceReconnect: () => fixture.reconnect
}))
vi.mock('../transport/use-open-mobile-host-edit', () => ({
  useOpenMobileHostEdit: () => fixture.edit
}))
vi.mock('../accounts/use-open-mobile-accounts', () => ({ useOpenMobileAccounts: () => vi.fn() }))
vi.mock('../session/use-open-mobile-session', () => ({
  useOpenMobileSession: () => fixture.openSession
}))
vi.mock('../tasks/use-open-mobile-tasks', () => ({ useOpenMobileTasks: () => vi.fn() }))
vi.mock('../cache/worktree-cache', () => ({ getProvenCachedWorktrees: () => [] }))
vi.mock('../transport/host-removal-lifecycle', () => ({ removeHostAndCloseClient: fixture.remove }))
vi.mock('../platform/haptics', () => ({ triggerMediumImpact: vi.fn() }))
vi.mock('../components/ActionSheetModal', () => ({
  ActionSheetModal: (props: { visible: boolean }) => {
    fixture.menus.push(props)
    return createElement('ActionSheet', props)
  }
}))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: 'Confirm' }))
vi.mock('../components/MobileHomeQuickActions', () => ({ MobileHomeQuickActions: 'QuickActions' }))
vi.mock('../runtime-directory/MobileRuntimeSelector', () => ({
  MobileRuntimeSelector: 'RuntimeSelector'
}))
vi.mock('./use-mobile-home-data', () => ({ useMobileHomeData: () => fixture.data }))
vi.mock('./MobileHomeToolbar', () => ({ MobileHomeToolbar: 'Toolbar' }))
vi.mock('./MobileHomeDrawer', () => ({ MobileHomeDrawer: 'Drawer' }))
vi.mock('./MobileHomeEmptyState', () => ({ MobileHomeEmptyState: 'OriginalEmptyState' }))
vi.mock('./MobileAccountComputerActions', () => ({
  MobileAccountComputerActions: 'AccountComputerActions'
}))
vi.mock('./MobileHomeHostList', () => ({
  MobileHomeHostList: (props: { footer: React.ReactNode }) =>
    createElement('HostList', props, props.footer)
}))
vi.mock('./MobileHomeListFooter', () => ({ MobileHomeListFooter: 'OverviewFooter' }))
vi.mock('../devices/MobileDeviceManagementScreen', async () => {
  const { useMobileHomeContext } = await import('./mobile-home-context')
  return {
    MobileDeviceManagementScreen: () => {
      const context = useMobileHomeContext()
      return createElement('DevicesPage', {
        hosts: context.data.hostCatalog,
        selectedId: context.selectedRuntime?.id,
        onBack: context.data.router.back
      })
    }
  }
})

function MainShell() {
  return createElement(
    MobileHomeProvider,
    null,
    createElement(
      fixture.destination === 'devices' ? MobileDeviceManagementScreen : MobileHomeScreen
    )
  )
}

function mount() {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(MainShell))
  })
  return renderer
}

function addRuntimes() {
  const hosts = ['runtime-a', 'runtime-b'].map((id) => ({
    id,
    name: id,
    credentialStatus: 'ready',
    endpoint: 'wss://test.invalid',
    publicKeyB64: 'test-key',
    lastConnected: 0,
    profile: {
      id,
      name: id,
      endpoint: 'wss://test.invalid',
      publicKeyB64: 'test-key',
      deviceToken: 'test-token',
      lastConnected: 0
    }
  }))
  Object.assign(fixture.data, {
    hostCatalog: hosts,
    sortedHostCatalog: hosts,
    primaryHost: hosts[0].profile,
    connectedHosts: hosts.map((host) => host.profile),
    taskProvidersByHost: { 'runtime-a': ['github'], 'runtime-b': ['linear'] }
  })
  return hosts
}

describe('Orca home in the Stack', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    vi.clearAllMocks()
    fixture.params = {}
    fixture.destination = 'index'
    fixture.router.push.mockImplementation((route) => {
      if (route === '/devices') {
        fixture.previousDestination = fixture.destination
        fixture.destination = 'devices'
      }
    })
    fixture.router.back.mockImplementation(() => {
      fixture.destination = fixture.previousDestination
    })
    fixture.session = null
    fixture.connected = true
    fixture.router.setParams.mockImplementation((updates) => Object.assign(fixture.params, updates))
    fixture.router.navigate.mockImplementation((route) => {
      fixture.destination = route === '/devices' ? 'devices' : 'index'
    })
    fixture.data = {
      router: fixture.router,
      hostCatalog: [],
      sortedHostCatalog: [],
      primaryHost: null,
      connectedHosts: [],
      resumeCard: null,
      accountsHosts: [],
      primaryTaskProviders: [],
      taskProvidersByHost: {},
      reloadHostCatalog: vi.fn().mockResolvedValue([]),
      hostStates: {},
      autoConnectHostIds: [],
      hostAttempts: {},
      hostLastConnected: {},
      hostPairingRejected: {},
      hostSignedOut: {},
      hostPaths: {},
      hostPendingPaths: {},
      stats: null,
      worktreeInfo: {}
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([true, false])(
    'opens the account Runtime menu with alias editing when connected=%s',
    (connected) => {
      const hosts = addRuntimes()
      const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      Object.assign(hosts[0], {
        id: runtimeRecordId,
        runtimeRecordId,
        accessSources: ['account-claimed'],
        ...(connected ? {} : { profile: null, credentialStatus: 'cloud-offline' })
      })
      fixture.session = { authorityId: 'cloud', account: { accountId: 'account-a' } }
      fixture.data.hostStates = { [runtimeRecordId]: connected ? 'connected' : 'disconnected' }
      renderer = mount()
      act(() => findByHostType(renderer!.root, 'HostList').props.onOpenActions(hosts[0]))
      const menu = findByHostType(renderer.root, 'ActionSheet')
      expect(menu.props.visible).toBe(true)
      const labels = menu.props.actions.map((action: { label: string }) => action.label)
      expect(labels).toContain('修改云端别名')
      expect(labels).toContain('Session management')
      expect(labels).not.toContain('Remove local pairing')
      act(() =>
        menu.props.actions
          .find((action: { label: string }) => action.label === '修改云端别名')
          .onPress()
      )
      expect(fixture.edit).toHaveBeenCalledExactlyOnceWith(runtimeRecordId)
    }
  )

  it('routes account session management to the selected Runtime', () => {
    const hosts = addRuntimes()
    const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    Object.assign(hosts[0], { runtimeRecordId, accessSources: ['account-claimed'] })
    fixture.session = { authorityId: 'cloud', account: { accountId: 'account-a' } }
    renderer = mount()
    act(() => findByHostType(renderer!.root, 'HostList').props.onOpenActions(hosts[0]))
    act(() =>
      findByHostType(renderer!.root, 'ActionSheet')
        .props.actions.find((action: { label: string }) => action.label === 'Session management')
        .onPress()
    )
    expect(fixture.router.push).toHaveBeenCalledWith({
      pathname: '/runtime-sessions',
      params: { runtimeRecordId }
    })
  })

  it('invalidates deferred account Runtime actions after switching accounts', () => {
    const hosts = addRuntimes()
    Object.assign(hosts[0], {
      runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      accessSources: ['account-claimed']
    })
    fixture.session = { authorityId: 'cloud', account: { accountId: 'account-a' } }
    renderer = mount()
    act(() => findByHostType(renderer!.root, 'HostList').props.onOpenActions(hosts[0]))
    const actions = findByHostType(renderer.root, 'ActionSheet').props.actions
    expect(actions.length).toBeGreaterThan(0)
    fixture.session = { authorityId: 'cloud', account: { accountId: 'account-b' } }
    act(() => renderer!.update(createElement(MainShell)))
    expect(findByHostType(renderer.root, 'ActionSheet').props.visible).toBe(false)
    act(() => actions.forEach((action: { onPress: () => void }) => action.onPress()))
    expect(fixture.edit).not.toHaveBeenCalled()
    expect(fixture.reconnect).not.toHaveBeenCalled()
    expect(fixture.disconnect).not.toHaveBeenCalled()
    expect(fixture.router.push).not.toHaveBeenCalled()
    expect(fixture.remove).not.toHaveBeenCalled()
  })

  it('shows original pairing onboarding when no computers are paired', () => {
    renderer = mount()
    expect(findAllByHostType(renderer.root, 'Navigation')).toHaveLength(0)
    expect(findAllByHostType(renderer.root, 'HostList')).toHaveLength(0)
    const empty = findByHostType(renderer.root, 'OriginalEmptyState')
    expect(empty.props.bottomInset).toBe(0)
    expect(empty.props.method).toBe('scan')
    act(() => empty.props.onPairDesktop())
    expect(fixture.router.push).toHaveBeenCalledWith('/pair-scan')
  })

  it('keeps the original computer list and multi-computer workspace picker', () => {
    const hosts = addRuntimes()
    fixture.params.runtimeId = 'runtime-b'
    renderer = mount()
    const list = findByHostType(renderer.root, 'HostList')
    expect(list.props.hosts).toEqual(hosts)
    expect(list.props.bottomInset).toBe(0)
    const footer = findByHostType(renderer.root, 'OverviewFooter')
    expect(findAllByHostType(renderer.root, 'AccountComputerActions')).toHaveLength(0)
    expect(footer.props.primaryHost.id).toBe('runtime-b')
    expect(footer.props.primaryTaskProviders).toEqual(['linear'])
    expect(footer.props.connectedHosts).toEqual(hosts.map((host) => host.profile))
  })

  it('keeps offline but locally paired computers on the home overview and disables execution on the selected offline Runtime', () => {
    const hosts = addRuntimes()
    fixture.params.runtimeId = 'runtime-b'
    fixture.connected = false
    renderer = mount()
    expect(findAllByHostType(renderer.root, 'OriginalEmptyState')).toHaveLength(0)
    expect(findByHostType(renderer.root, 'HostList').props.hosts).toEqual(hosts)
    expect(findByHostType(renderer.root, 'Drawer').props.canOpenHostActions).toBe(false)
    act(() => findByHostType(renderer!.root, 'Drawer').props.onManageDevices())
    act(() => renderer!.update(createElement(MainShell)))
    expect(findByHostType(renderer.root, 'DevicesPage').props.hosts).toEqual(hosts)
  })

  it('retains the menu control in the home toolbar', () => {
    renderer = mount()
    act(() => findByHostType(renderer!.root, 'Toolbar').props.onOpenMenu())
    expect(findByHostType(renderer.root, 'Drawer').props.visible).toBe(true)
    act(() => findByHostType(renderer!.root, 'Drawer').props.onClose())
    expect(findByHostType(renderer.root, 'Drawer').props.visible).toBe(false)
  })

  it('shows the home overview directly once an account session exists, even without local pairing', () => {
    const hosts = addRuntimes()
    hosts.forEach((host) => Object.assign(host, { accessSources: ['account-claimed'] }))
    fixture.connected = false
    renderer = mount()
    expect(findByHostType(renderer.root, 'OriginalEmptyState').props.method).toBe('scan')
    fixture.session = { authorityId: 'cloud', account: { accountId: 'account-a' } }
    act(() => renderer!.update(createElement(MainShell)))
    expect(findAllByHostType(renderer.root, 'OriginalEmptyState')).toHaveLength(0)
    expect(findByHostType(renderer.root, 'HostList').props.hosts).toEqual(hosts)
    fixture.session = null
    act(() => renderer!.update(createElement(MainShell)))
    expect(findByHostType(renderer.root, 'OriginalEmptyState').props.method).toBe('scan')
  })

  it('keeps the chosen Runtime through devices and back to the home overview', () => {
    addRuntimes()
    renderer = mount()
    act(() => findByHostType(renderer!.root, 'RuntimeSelector').props.onSelect('runtime-b'))
    act(() => findByHostType(renderer!.root, 'Drawer').props.onManageDevices())
    act(() => renderer!.update(createElement(MainShell)))
    const devices = findByHostType(renderer.root, 'DevicesPage')
    expect(devices.props.selectedId).toBe('runtime-b')
    expect(findAllByHostType(renderer.root, 'Toolbar')).toHaveLength(0)
    expect(fixture.router.push).toHaveBeenCalledWith('/devices')
    act(() => devices.props.onBack())
    act(() => renderer!.update(createElement(MainShell)))
    expect(findByHostType(renderer.root, 'OverviewFooter').props.primaryHost.id).toBe('runtime-b')
  })

  it('offers pairing from the runtime selector without changing the chosen computer', () => {
    addRuntimes()
    renderer = mount()
    act(() => findByHostType(renderer!.root, 'RuntimeSelector').props.onSelect('runtime-b'))
    expect(findByHostType(renderer.root, 'RuntimeSelector').props.onManageDevices).toBeUndefined()
    act(() => findByHostType(renderer!.root, 'RuntimeSelector').props.onPair())
    expect(fixture.router.push).toHaveBeenCalledWith('/pair-scan')
    expect(findByHostType(renderer.root, 'OverviewFooter').props.primaryHost.id).toBe('runtime-b')
  })

  it.each(['removed', 'credentials', 'access', 'account', 'account-cycle', 'unmount'])(
    'invalidates local device menus and deferred operations after %s changes',
    async (change) => {
      const hosts = addRuntimes()
      fixture.session = { authorityId: 'cloud', account: { accountId: 'a' } }
      fixture.data.hostStates = { 'runtime-a': 'connected' }
      renderer = mount()
      act(() => findByHostType(renderer!.root, 'HostList').props.onOpenActions(hosts[0]))
      const actions = findByHostType(renderer.root, 'ActionSheet').props.actions
      if (change === 'unmount') {
        act(() => {
          renderer!.unmount()
          renderer = null
        })
      } else {
        if (change === 'account' || change === 'account-cycle') {
          fixture.session = { authorityId: 'cloud', account: { accountId: 'b' } }
        } else if (change === 'access') {
          fixture.data.hostCatalog = hosts.map((host, index) =>
            index === 0 ? { ...host, accessSources: ['account-claimed'] } : host
          )
        } else {
          fixture.data.hostCatalog =
            change === 'removed'
              ? hosts.slice(1)
              : hosts.map((host, index) =>
                  index === 0
                    ? { ...host, profile: { ...host.profile, deviceToken: 'replacement-token' } }
                    : host
                )
        }
        act(() => renderer!.update(createElement(MainShell)))
        expect(findByHostType(renderer.root, 'ActionSheet').props.visible).toBe(false)
        if (change === 'account-cycle') {
          fixture.session = { authorityId: 'cloud', account: { accountId: 'a' } }
          act(() => renderer!.update(createElement(MainShell)))
        }
      }
      await act(async () => actions.forEach((action: { onPress: () => void }) => action.onPress()))
      expect(fixture.reconnect).not.toHaveBeenCalled()
      expect(fixture.disconnect).not.toHaveBeenCalled()
      expect(fixture.edit).not.toHaveBeenCalled()
      expect(fixture.router.push).not.toHaveBeenCalled()
      if (renderer) {
        expect(findByHostType(renderer.root, 'Confirm').props.visible).toBe(false)
      }
    }
  )

  it('rejects an old removal confirmation after account change', async () => {
    const hosts = addRuntimes()
    fixture.session = { authorityId: 'cloud', account: { accountId: 'a' } }
    renderer = mount()
    act(() => findByHostType(renderer!.root, 'HostList').props.onOpenActions(hosts[0]))
    act(() =>
      findByHostType(renderer!.root, 'ActionSheet')
        .props.actions.find((action: { label: string }) => action.label === 'Remove local pairing')
        .onPress()
    )
    const confirm = findByHostType(renderer.root, 'Confirm').props.onConfirm
    fixture.menus = []
    fixture.session = { authorityId: 'cloud', account: { accountId: 'b' } }
    act(() => renderer!.update(createElement(MainShell)))
    await act(async () => confirm())
    expect(fixture.remove).not.toHaveBeenCalled()
    expect(findByHostType(renderer.root, 'Confirm').props.visible).toBe(false)
  })

  it('hides the previous account menu on the first render after account changes', () => {
    const hosts = addRuntimes()
    fixture.session = { authorityId: 'cloud', account: { accountId: 'a' } }
    renderer = mount()
    act(() => findByHostType(renderer!.root, 'HostList').props.onOpenActions(hosts[0]))
    fixture.menus = []
    fixture.session = { authorityId: 'cloud', account: { accountId: 'b' } }
    act(() => renderer!.update(createElement(MainShell)))
    expect(fixture.menus.length).toBeGreaterThan(0)
    expect(fixture.menus.every((menu) => !menu.visible)).toBe(true)
  })

  it('does not reopen a canceled removal when its asynchronous operation fails', async () => {
    const hosts = addRuntimes()
    let reject!: (error: Error) => void
    const removal = new Promise<void>((_resolve, fail) => {
      reject = fail
    })
    fixture.remove.mockReturnValueOnce(removal)
    renderer = mount()
    act(() => findByHostType(renderer!.root, 'HostList').props.onOpenActions(hosts[0]))
    act(() =>
      findByHostType(renderer!.root, 'ActionSheet')
        .props.actions.find((action: { label: string }) => action.label === 'Remove local pairing')
        .onPress()
    )
    act(() => findByHostType(renderer!.root, 'Confirm').props.onConfirm())
    act(() => findByHostType(renderer!.root, 'Confirm').props.onCancel())
    await act(async () => {
      reject(new Error('storage unavailable'))
      await removal.catch(() => {})
    })
    expect(findByHostType(renderer.root, 'Confirm').props.visible).toBe(false)
  })

  it('keeps valid local pairing removal available', async () => {
    const hosts = addRuntimes()
    renderer = mount()
    act(() => findByHostType(renderer!.root, 'HostList').props.onOpenActions(hosts[0]))
    act(() =>
      findByHostType(renderer!.root, 'ActionSheet')
        .props.actions.find((action: { label: string }) => action.label === 'Remove local pairing')
        .onPress()
    )
    await act(async () => findByHostType(renderer!.root, 'Confirm').props.onConfirm())
    expect(fixture.remove).toHaveBeenCalledWith('runtime-a', expect.any(Function))
    expect(fixture.data.reloadHostCatalog).toHaveBeenCalledOnce()
  })

  it('keeps valid edit navigation available after the native menu finishes closing', () => {
    const hosts = addRuntimes()
    renderer = mount()
    act(() => findByHostType(renderer!.root, 'HostList').props.onOpenActions(hosts[0]))
    const edit = findByHostType(renderer.root, 'ActionSheet').props.actions.find(
      (action: { label: string }) => action.label === '修改别名与连接地址'
    )
    act(() => findByHostType(renderer!.root, 'ActionSheet').props.onClose())
    expect(findByHostType(renderer.root, 'ActionSheet').props.visible).toBe(false)
    act(() => edit.onPress())
    expect(fixture.edit).toHaveBeenCalledExactlyOnceWith('runtime-a')
  })

  it.each(['account', 'unmount'])(
    'does not reopen an old removal after async failure and %s change',
    async (change) => {
      const hosts = addRuntimes()
      fixture.session = { authorityId: 'cloud', account: { accountId: 'a' } }
      let reject!: (error: Error) => void
      const removal = new Promise<void>((_resolve, fail) => {
        reject = fail
      })
      fixture.remove.mockReturnValueOnce(removal)
      renderer = mount()
      act(() => findByHostType(renderer!.root, 'HostList').props.onOpenActions(hosts[0]))
      act(() =>
        findByHostType(renderer!.root, 'ActionSheet')
          .props.actions.find(
            (action: { label: string }) => action.label === 'Remove local pairing'
          )
          .onPress()
      )
      act(() => findByHostType(renderer!.root, 'Confirm').props.onConfirm())
      if (change === 'unmount') {
        act(() => {
          renderer!.unmount()
          renderer = null
        })
      } else {
        fixture.session = { authorityId: 'cloud', account: { accountId: 'b' } }
        act(() => renderer!.update(createElement(MainShell)))
      }
      await act(async () => {
        reject(new Error('storage unavailable'))
        await removal.catch(() => {})
      })
      if (renderer) {
        expect(findByHostType(renderer.root, 'Confirm').props.visible).toBe(false)
      }
      expect(fixture.data.reloadHostCatalog).not.toHaveBeenCalled()
    }
  )
})
