import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { MobileAccountComputerActions } from './MobileAccountComputerActions'

const fixture = vi.hoisted(() => ({
  hydrated: true,
  session: null as object | null,
  state: { status: 'ready', error: null as string | null },
  refresh: vi.fn(),
  push: vi.fn()
}))
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({ UserRound: 'UserRound', RefreshCw: 'RefreshCw' }))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: fixture.push }) }))
vi.mock('../auth/mobile-auth-session', () => ({ useMobileAuthSession: () => fixture }))
vi.mock('../runtime-directory/account-runtime-directory-provider', () => ({
  useAccountRuntimeDirectory: () => fixture
}))
vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => lightTheme,
  useMobileThemeStyles: (styles: (theme: typeof lightTheme) => unknown) => styles(lightTheme)
}))
let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.clearAllMocks()
  fixture.hydrated = true
  fixture.session = null
  fixture.state = { status: 'ready', error: null }
})
afterEach(() => act(() => renderer?.unmount()))
function mount() {
  act(() => {
    renderer = create(createElement(MobileAccountComputerActions))
  })
}
function press(label: string) {
  act(() => renderer!.root.findByProps({ accessibilityLabel: label }).props.onPress())
}

it('opens the existing HiveCloud login when signed out', () => {
  mount()
  press('登录 HiveCloud')
  expect(fixture.push).toHaveBeenCalledWith('/login')
  expect(fixture.refresh).not.toHaveBeenCalled()
})

it('opens the actual claim flow when signed in and allows account computer refresh', () => {
  fixture.session = {}
  mount()
  press('认领新电脑')
  expect(fixture.push).toHaveBeenCalledWith('/claim-computer')
  press('刷新账号电脑')
  expect(fixture.refresh).toHaveBeenCalledOnce()
})

it('disables login during auth hydration and displays directory errors without hiding claim', () => {
  fixture.hydrated = false
  mount()
  expect(renderer!.root.findByProps({ accessibilityLabel: '登录 HiveCloud' }).props.disabled).toBe(
    true
  )
  fixture.hydrated = true
  fixture.session = {}
  fixture.state = { status: 'error', error: '网络不可用' }
  act(() => renderer!.update(createElement(MobileAccountComputerActions)))
  expect(renderer!.root.findByProps({ accessibilityRole: 'alert' }).children.join('')).toContain(
    '网络不可用'
  )
  expect(renderer!.root.findByProps({ accessibilityLabel: '认领新电脑' }).props.disabled).toBe(
    false
  )
})
