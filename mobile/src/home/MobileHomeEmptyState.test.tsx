import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { MobileHomeEmptyState } from './MobileHomeEmptyState'
import type { ConnectionState, HostCatalogEntry } from '../transport/types'

const fixture = vi.hoisted(() => ({
  hydrated: true,
  session: null as object | null,
  state: { status: 'ready', error: null as string | null },
  push: vi.fn(),
  refresh: vi.fn()
}))
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({
  QrCode: 'QrCode',
  UserRound: 'UserRound',
  Monitor: 'Monitor',
  ChevronRight: 'ChevronRight',
  RefreshCw: 'RefreshCw'
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: fixture.push }) }))
vi.mock('../auth/mobile-auth-session', () => ({ useMobileAuthSession: () => fixture }))
vi.mock('../runtime-directory/account-runtime-directory-provider', () => ({
  useAccountRuntimeDirectory: () => fixture
}))
vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => lightTheme,
  useMobileThemeStyles: (styles: (theme: typeof lightTheme) => unknown) => styles(lightTheme)
}))
const accountComputer: HostCatalogEntry = {
  id: 'account-computer',
  name: '开发电脑',
  credentialStatus: 'ready',
  accessSources: ['account-claimed'],
  endpoint: 'wss://test.invalid',
  lastConnected: 0,
  profile: {
    id: 'account-computer',
    name: '开发电脑',
    endpoint: 'wss://test.invalid',
    deviceToken: 'test-token',
    publicKeyB64: 'test-key',
    lastConnected: 0
  }
}
let renderer: ReactTestRenderer | null = null
let method: 'scan' | 'account'
let computers: HostCatalogEntry[]
let connectionStates: Record<string, ConnectionState>
let onPairDesktop: ReturnType<typeof vi.fn>,
  onSelectComputer: ReturnType<typeof vi.fn>,
  onOpenComputer: ReturnType<typeof vi.fn>
function props(): ComponentProps<typeof MobileHomeEmptyState> {
  return {
    bottomInset: 0,
    contentMaxWidth: 600,
    isWideLayout: false,
    method,
    accountComputers: computers,
    connectionStates,
    selectedId: null,
    onMethodChange: (next: typeof method) => {
      method = next
      renderer!.update(createElement(MobileHomeEmptyState, props()))
    },
    onPairDesktop,
    onSelectComputer,
    onOpenComputer
  }
}
function mount() {
  act(() => {
    renderer = create(createElement(MobileHomeEmptyState, props()))
  })
}
function labels() {
  return renderer!.root
    .findAllByType('Text')
    .map((node) => node.children.join(''))
    .join('\n')
}
function press(label: string) {
  act(() =>
    renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === label)!
      .props.onPress()
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  fixture.hydrated = true
  fixture.session = null
  fixture.state = { status: 'ready', error: null }
  method = 'scan'
  computers = []
  connectionStates = {}
  onPairDesktop = vi.fn()
  onSelectComputer = vi.fn()
  onOpenComputer = vi.fn()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

it('defaults to scan with one main action and only QR connection steps', () => {
  mount()
  expect(labels()).toContain('使用手机扫描二维码')
  expect(labels()).not.toContain('选择已认领的电脑')
  expect(renderer!.root.findAllByProps({ testID: 'home-connection-primary' })).toHaveLength(1)
  press('扫描二维码')
  expect(onPairDesktop).toHaveBeenCalledOnce()
  press('连接遇到问题？')
  expect(onPairDesktop).toHaveBeenCalledTimes(2)
  expect(fixture.push).not.toHaveBeenCalledWith('/pair')
})

it('switches the description, main action, icon and steps together for account login', () => {
  mount()
  press('账号连接')
  expect(labels()).toContain('从账号中选择电脑')
  expect(labels()).toContain('选择已认领的电脑')
  expect(labels()).not.toContain('使用手机扫描二维码')
  expect(renderer!.root.findAllByProps({ testID: 'home-connection-primary' })).toHaveLength(1)
  press('登录 HiveCloud')
  expect(fixture.push).toHaveBeenCalledWith('/login')
  expect(fixture.push).not.toHaveBeenCalledWith('/claim-computer')
  press('扫码连接')
  expect(labels()).toContain('使用手机扫描二维码')
})

it('shows claimed computers and selects them without asking a signed-in user to log in again', () => {
  fixture.session = {}
  method = 'account'
  computers = [accountComputer]
  mount()
  expect(labels()).toContain('开发电脑')
  expect(labels()).not.toContain('登录 HiveCloud\n')
  press('选择电脑')
  expect(onSelectComputer).toHaveBeenCalledOnce()
  expect(fixture.push).not.toHaveBeenCalled()
  press('连接开发电脑，不可验证')
  expect(onOpenComputer).toHaveBeenCalledWith(accountComputer)
})

it.each([
  ['connected', '在线', false],
  ['connecting', '连接中', true],
  ['handshaking', '连接中', true],
  ['reconnecting', '正在重连', true],
  ['auth-failed', '连接未通过', false]
] as const)('announces computer status and busy state for %s', (state, status, busy) => {
  fixture.session = {}
  method = 'account'
  computers = [accountComputer]
  connectionStates = { [accountComputer.id]: state }
  mount()
  const row = renderer!.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel?.startsWith('连接开发电脑'))!
  expect(row.props.accessibilityLabel).toBe(`连接开发电脑，${status}`)
  expect(row.props.accessibilityState).toEqual({ busy, disabled: false })
})

it('announces offline status and keeps the computer row disabled', () => {
  fixture.session = {}
  method = 'account'
  computers = [{ ...accountComputer, credentialStatus: 'cloud-offline', profile: null }]
  mount()
  const row = renderer!.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel?.startsWith('连接开发电脑'))!
  expect(row.props.accessibilityLabel).toBe('连接开发电脑，离线')
  expect(row.props.accessibilityState).toEqual({ busy: false, disabled: true })
  expect(row.props.disabled).toBe(true)
  act(() => row.props.onPress())
  expect(onOpenComputer).not.toHaveBeenCalled()
})

it('only guides claim after a successful empty directory load', () => {
  fixture.session = {}
  method = 'account'
  mount()
  expect(labels()).toContain('还没有已认领的电脑')
  press('认领电脑')
  expect(fixture.push).toHaveBeenCalledWith('/claim-computer')
})

it('makes directory failure retryable rather than treating it as an empty account', () => {
  fixture.session = {}
  method = 'account'
  fixture.state = { status: 'error', error: '网络不可用' }
  mount()
  expect(labels()).toContain('网络不可用')
  expect(labels()).not.toContain('还没有已认领的电脑')
  press('重新获取电脑')
  expect(fixture.refresh).toHaveBeenCalledOnce()
  expect(fixture.push).not.toHaveBeenCalled()
})

it('disables account action during auth hydration or first directory loading while keeping scan available', () => {
  fixture.hydrated = false
  method = 'account'
  mount()
  expect(renderer!.root.findByProps({ testID: 'home-connection-primary' }).props.disabled).toBe(
    true
  )
  fixture.hydrated = true
  fixture.session = {}
  fixture.state = { status: 'loading', error: null }
  act(() => renderer!.update(createElement(MobileHomeEmptyState, props())))
  expect(labels()).not.toContain('还没有已认领的电脑')
  expect(renderer!.root.findByProps({ testID: 'home-connection-primary' }).props.disabled).toBe(
    true
  )
  press('扫码连接')
  press('扫描二维码')
  expect(onPairDesktop).toHaveBeenCalledOnce()
})
