import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { deviceCatalog } from './mobile-devices.test-fixture'
import { MobileDeviceManagementScreen } from './MobileDeviceManagementScreen'
import type { MobileHomeContextValue } from '../home/mobile-home-context'

const fixture = vi.hoisted(() => ({
  context: {} as MobileHomeContextValue,
  session: null as { authorityId: string; account: { accountId: string } } | null,
  directory: {
    state: { entries: [], status: 'ready', error: null },
    refresh: vi.fn().mockResolvedValue(undefined)
  },
  forceReconnect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn()
}))
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    ['Activity', 'PowerOff', 'RefreshCw', 'ScanLine', 'UserRound', 'X'].map((name) => [
      name,
      'Icon'
    ])
  )
)
vi.mock('../home/mobile-home-context', () => ({ useMobileHomeContext: () => fixture.context }))
vi.mock('../home/MobileHomeToolbar', () => ({ MobileHomeToolbar: 'Toolbar' }))
vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ hydrated: true, session: fixture.session })
}))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ contentMaxWidth: 600 })
}))
vi.mock('../theme/mobile-theme-provider', () => ({ useMobileTheme: () => lightTheme }))
vi.mock('../runtime-directory/account-runtime-directory-provider', () => ({
  useAccountRuntimeDirectory: () => fixture.directory
}))
vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => fixture.forceReconnect,
  useDisconnectHostClient: () => fixture.disconnect
}))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: 'Menu' }))
vi.mock('./MobileDevicesScreen', () => ({ MobileDevicesScreen: 'Screen' }))
vi.mock('./MobileDeviceMenus', () => ({
  MobileDeviceAddMenu: 'AddMenu',
  MobileDeviceHelpSheet: 'Help'
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})
beforeEach(() => {
  vi.clearAllMocks()
  fixture.session = null
  fixture.context = {
    selectedRuntime: deviceCatalog[0],
    selectedRuntimeClient: {},
    activeConnectedHost: deviceCatalog[0].profile,
    openMenu: vi.fn(),
    selectRuntime: vi.fn(),
    openHostActions: vi.fn(),
    data: {
      sortedHostCatalog: deviceCatalog,
      hostCatalogLoaded: true,
      hostCatalogError: null,
      hostStates: { 'device-0': 'connected', 'device-2': 'connected' },
      autoConnectHostIds: [],
      hostAttempts: {},
      hostLastConnected: {},
      hostPendingPaths: {},
      hostPairingRejected: {},
      hostSignedOut: {},
      hostPaths: {},
      reloadHostCatalog: vi.fn().mockResolvedValue([]),
      router: {
        push: vi.fn(),
        navigate: vi.fn(),
        canGoBack: vi.fn().mockReturnValue(true),
        back: vi.fn(),
        replace: vi.fn()
      }
    }
  }
})
const mount = () =>
  act(() => {
    renderer = create(createElement(MobileDeviceManagementScreen))
  })
describe('secondary device management integration', () => {
  it('opens real scan/login/claim routes with a single account-aware add menu', () => {
    mount()
    act(() => renderer!.root.findByType('Screen').props.onAdd())
    expect(renderer!.root.findByType('AddMenu').props.visible).toBe(true)
    act(() => renderer!.root.findByType('AddMenu').props.onPair())
    expect(fixture.context.data.router.push).toHaveBeenCalledWith('/pair-scan')
    act(() => renderer!.root.findByType('AddMenu').props.onAccount())
    expect(fixture.context.data.router.push).toHaveBeenCalledWith('/login')
    fixture.session = { authorityId: 'cloud', account: { accountId: 'a' } }
    act(() => renderer!.update(createElement(MobileDeviceManagementScreen)))
    act(() => renderer!.root.findByType('AddMenu').props.onAccount())
    expect(fixture.context.data.router.push).toHaveBeenCalledWith('/claim-computer')
  })
  it('opens host-scoped diagnostics and help and returns using Stack navigation', () => {
    mount()

    act(() => renderer!.root.findByType('Screen').props.onDetails(deviceCatalog[1]))
    expect(fixture.context.data.router.push).toHaveBeenCalledWith({
      pathname: '/connection-log',
      params: { hostId: 'device-1' }
    })
    act(() => renderer!.root.findByType('Toolbar').props.onBack())
    expect(fixture.context.data.router.back).toHaveBeenCalledOnce()
    act(() => renderer!.root.findByType('Screen').props.onHelp())
    expect(renderer!.root.findByType('Help').props.visible).toBe(true)
  })
  it('refreshes only the account directory and local catalog without exposing execution shortcuts', async () => {
    mount()
    await act(async () => renderer!.root.findByType('Toolbar').props.onRefresh())
    expect(fixture.directory.refresh).toHaveBeenCalledOnce()
    expect(fixture.context.data.reloadHostCatalog).toHaveBeenCalledOnce()
    expect(renderer!.root.findByType('Screen').props.onUse).toBeUndefined()
    expect(fixture.context.selectRuntime).not.toHaveBeenCalled()
  })
  it('keeps local pairing management and limits account-device menus to connection operations', () => {
    mount()
    act(() => renderer!.root.findByType('Screen').props.onActions(deviceCatalog[0]))
    expect(fixture.context.openHostActions).toHaveBeenCalledWith(deviceCatalog[0])
    act(() => renderer!.root.findByType('Screen').props.onActions(deviceCatalog[2]))
    const menu = renderer!.root.findByType('Menu')
    expect(menu.props.actions.map((action: { label: string }) => action.label)).toEqual([
      '重试连接',
      '断开连接',
      '连接详情'
    ])
    act(() => menu.props.actions[1].onPress())
    expect(fixture.disconnect).toHaveBeenCalledExactlyOnceWith('device-2')
  })
  it.each(['auth-failed', 'pairing-rejected'] as const)(
    'routes locally stored %s credentials to pairing instead of redialing them',
    async (failure) => {
      fixture.context.data.hostStates = {
        'device-0': failure === 'auth-failed' ? 'auth-failed' : 'reconnecting'
      }
      fixture.context.data.hostPairingRejected = { 'device-0': failure === 'pairing-rejected' }
      mount()
      await act(async () => renderer!.root.findByType('Screen').props.onRetry(deviceCatalog[0]))
      expect(fixture.context.data.router.push).toHaveBeenCalledExactlyOnceWith('/pair-scan')
      expect(fixture.forceReconnect).not.toHaveBeenCalled()
    }
  )
  it('does not run delayed account menu actions or account navigation after switching accounts', async () => {
    fixture.session = { authorityId: 'cloud', account: { accountId: 'a' } }
    mount()
    act(() => renderer!.root.findByType('Screen').props.onActions(deviceCatalog[2]))
    const previousActions = renderer!.root.findByType('Menu').props.actions
    const previousAccountNavigation = renderer!.root.findByType('AddMenu').props.onAccount
    fixture.session = { authorityId: 'cloud', account: { accountId: 'b' } }
    act(() => renderer!.update(createElement(MobileDeviceManagementScreen)))
    await act(async () => {
      previousActions.forEach((action: { onPress: () => void }) => action.onPress())
      previousAccountNavigation()
    })
    expect(fixture.forceReconnect).not.toHaveBeenCalled()
    expect(fixture.disconnect).not.toHaveBeenCalled()
    expect(fixture.context.data.router.push).not.toHaveBeenCalled()
  })
  it('re-resolves credentials when a deferred retry runs after a directory update', async () => {
    mount()
    act(() => renderer!.root.findByType('Screen').props.onActions(deviceCatalog[2]))
    const previousRetry = renderer!.root.findByType('Menu').props.actions[0].onPress
    fixture.context.data.sortedHostCatalog = deviceCatalog.map((host) =>
      host.id === 'device-2'
        ? { ...host, name: 'Updated server', credentialStatus: 'cloud-offline', profile: null }
        : host
    )
    act(() => renderer!.update(createElement(MobileDeviceManagementScreen)))
    await act(async () => previousRetry())
    expect(fixture.forceReconnect).not.toHaveBeenCalled()
    expect(fixture.directory.refresh).toHaveBeenCalledOnce()
    expect(fixture.context.data.reloadHostCatalog).toHaveBeenCalledOnce()
    expect(renderer!.root.findByType('Menu').props.title).toBe('Updated server')
  })
  it('drops deferred actions for an account device removed from the current catalog', async () => {
    mount()
    act(() => renderer!.root.findByType('Screen').props.onActions(deviceCatalog[2]))
    const previousActions = renderer!.root.findByType('Menu').props.actions
    fixture.context.data.sortedHostCatalog = deviceCatalog.slice(0, 2)
    act(() => renderer!.update(createElement(MobileDeviceManagementScreen)))
    await act(async () =>
      previousActions.forEach((action: { onPress: () => void }) => action.onPress())
    )
    expect(renderer!.root.findByType('Menu').props.visible).toBe(false)
    expect(fixture.forceReconnect).not.toHaveBeenCalled()
    expect(fixture.disconnect).not.toHaveBeenCalled()
    expect(fixture.context.data.router.push).not.toHaveBeenCalled()
  })
  it('returns to the primary screen when device management is opened directly', () => {
    mount()
    fixture.context.data.router.canGoBack = vi.fn().mockReturnValue(false)
    act(() => renderer!.root.findByType('Toolbar').props.onBack())
    expect(fixture.context.data.router.replace).toHaveBeenCalledExactlyOnceWith('/')
  })
})
