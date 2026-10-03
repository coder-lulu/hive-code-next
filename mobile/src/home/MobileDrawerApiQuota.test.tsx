import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lightTheme, darkTheme, type MobileTheme } from '../theme/mobile-theme'
import { MobileDrawerApiQuota } from './MobileDrawerApiQuota'

const mocks = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn() }))
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (value: unknown) => value },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) }
}))
vi.mock('lucide-react-native', () => ({ Coins: 'Icon', ChevronRight: 'Icon', RefreshCw: 'Icon' }))
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback])
}))
vi.mock('../ai-account/mobile-ai-account-client', () => ({
  readMobileAiAccount: mocks.read,
  activateMobileAiAccount: vi.fn()
}))
vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ hydrated: true, session, refresh: mocks.refresh })
}))
let session: { authorityId: string; account: { accountId: string }; expiresAt: number } | null
let renderer: ReactTestRenderer
const snapshot = {
  accountId: 'a',
  account: { status: 'ACTIVE' },
  balance: { accountStatus: 'ACTIVE', freshness: 'CURRENT', availableQuota: '9007199254740993' }
}
beforeEach(() => {
  vi.clearAllMocks()
  session = { authorityId: 'hive', account: { accountId: 'a' }, expiresAt: 4_000_000_000_000 }
  mocks.read.mockResolvedValue(snapshot)
})
afterEach(() => act(() => renderer?.unmount()))
const text = () => JSON.stringify(renderer.toJSON())
async function mount(theme: MobileTheme = lightTheme) {
  const onOpen = vi.fn()
  await act(async () => {
    renderer = create(createElement(MobileDrawerApiQuota, { theme, onOpen }))
  })
  return onOpen
}
const refresh = () => renderer.root.findByProps({ accessibilityLabel: '刷新 API 额度' })

it('shows signed-out state without a request and opens login through the drawer action', async () => {
  session = null
  const onOpen = await mount()
  expect(text()).toContain('登录后查看')
  expect(mocks.read).not.toHaveBeenCalled()
  act(() =>
    renderer.root.findByProps({ accessibilityLabel: 'API 额度，登录后查看' }).props.onPress()
  )
  expect(onOpen).toHaveBeenCalledOnce()
})

it.each([lightTheme, darkTheme])(
  'preserves large balances and uses theme tokens',
  async (theme) => {
    const onOpen = await mount(theme)
    const entry = renderer.root.findByProps({
      accessibilityLabel: 'API 额度，9,007,199,254,740,993 积分'
    })
    act(() => entry.props.onPress())
    expect(onOpen).toHaveBeenCalledOnce()
    expect(refresh().props.style({ pressed: false })[0].minHeight).toBe(
      theme.size.minimumTouchTarget
    )
    expect(text()).toContain(theme.color.text.secondary)
  }
)

it('clears stale balances on failure and retries with zero quota', async () => {
  await mount()
  mocks.read.mockRejectedValueOnce(new Error('offline'))
  await act(async () => refresh().props.onPress())
  expect(text()).toContain('暂时不可用')
  expect(text()).not.toContain('9,007,199,254,740,993')
  mocks.read.mockResolvedValueOnce({
    ...snapshot,
    balance: { ...snapshot.balance, availableQuota: '0' }
  })
  await act(async () => refresh().props.onPress())
  expect(text()).toContain('0 积分')
})

it.each([
  ['NOT_PROVISIONED', '未激活'],
  ['PENDING', '准备中…'],
  ['DISABLED', '已停用'],
  ['UNKNOWN', '暂时不可用']
])('renders %s explicitly', async (status, label) => {
  mocks.read.mockResolvedValueOnce({ ...snapshot, account: { status }, balance: null })
  await mount()
  expect(text()).toContain(label)
})

it('disables refresh while loading and aborts the read when the drawer closes', async () => {
  mocks.read.mockImplementationOnce(() => new Promise(() => {}))
  await mount()
  expect(text()).toContain('获取中…')
  expect(refresh().props.disabled).toBe(true)
  const signal = mocks.read.mock.calls[0][1] as AbortSignal
  act(() => renderer.unmount())
  expect(signal.aborted).toBe(true)
})

it('ignores a late response after changing accounts', async () => {
  let finish!: (value: typeof snapshot) => void
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await mount()
  session = { ...session!, account: { accountId: 'b' } }
  mocks.read.mockResolvedValueOnce({
    ...snapshot,
    accountId: 'b',
    balance: { ...snapshot.balance, availableQuota: '2' }
  })
  await act(async () =>
    renderer.update(createElement(MobileDrawerApiQuota, { theme: lightTheme, onOpen: vi.fn() }))
  )
  await act(async () => finish(snapshot))
  expect(text()).toContain('2 积分')
  expect(text()).not.toContain('9,007,199,254,740,993')
})
