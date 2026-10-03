import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { MobileRuntimeClaimScreen } from './MobileRuntimeClaimScreen'

const fixture = vi.hoisted(() => ({
  hydrated: true,
  session: null as MobileSession | null,
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  preview: vi.fn(),
  sms: vi.fn(),
  approve: vi.fn()
}))
vi.mock('react-native', () => ({
  Keyboard: { addListener: () => ({ remove: vi.fn() }) },
  Platform: { OS: 'android' },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 12 })
}))
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft' }))
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: fixture.push, replace: fixture.replace, canGoBack: () => false })
}))
vi.mock('../auth/mobile-auth-session', () => ({ useMobileAuthSession: () => fixture }))
vi.mock('../auth/mobile-sms-client', () => ({ MobileApiError: class extends Error {} }))
vi.mock('./account-runtime-directory-provider', () => ({
  useAccountRuntimeDirectory: () => fixture
}))
vi.mock('./mobile-runtime-claim-client', () => ({
  normalizeMobileRuntimeClaimCode: (code: string) => code.trim().toUpperCase(),
  previewMobileRuntimeClaim: fixture.preview,
  startMobileRuntimeClaimSms: fixture.sms,
  approveMobileRuntimeClaim: fixture.approve
}))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, contentMaxWidth: 600 })
}))
vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => lightTheme,
  useMobileThemeStyles: (styles: (theme: typeof lightTheme) => unknown) => styles(lightTheme)
}))
const session = {
  accessToken: 'test-token',
  authorityId: 'cloud',
  account: { accountId: 'account-a', displayName: '测试账号' }
} as MobileSession
let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.clearAllMocks()
  fixture.hydrated = true
  fixture.session = null
  fixture.preview.mockResolvedValue({
    challengeId: 'claim-a',
    runtimeRecordId: 'runtime-a',
    runtimeVersion: '1.5.0',
    expectedVersion: 3,
    expiresAt: new Date(Date.now() + 300_000).toISOString()
  })
  fixture.sms.mockResolvedValue({
    challengeId: 'sms-a',
    expiresInSeconds: 120,
    resendAfterSeconds: 60,
    phoneNumberMasked: '+86 138****0000'
  })
  fixture.approve.mockResolvedValue({ status: 'APPROVED' })
})
afterEach(() => act(() => renderer?.unmount()))
function mount() {
  act(() => {
    renderer = create(createElement(MobileRuntimeClaimScreen))
  })
}
function labels() {
  return renderer!.root
    .findAllByType('Text')
    .map((node) => node.children.join(''))
    .join('\n')
}
async function press(label: string) {
  await act(async () => {
    renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === label)!
      .props.onPress()
    await Promise.resolve()
  })
}

it('gates the native claim form behind real authentication and supports cold-route return', async () => {
  mount()
  expect(renderer!.root.findAllByType('TextInput')).toHaveLength(0)
  await press('登录 HiveCloud')
  expect(fixture.push).toHaveBeenCalledWith('/login')
  await press('返回')
  expect(fixture.replace).toHaveBeenCalledWith('/')
  expect(fixture.preview).not.toHaveBeenCalled()
})

it('does not show login or claim fields until authentication has hydrated', () => {
  fixture.hydrated = false
  mount()
  expect(labels()).toContain('正在读取账号')
  expect(renderer!.root.findAllByType('TextInput')).toHaveLength(0)
  expect(renderer!.root.findAllByType('Pressable')).toHaveLength(1)
})

it('reviews the computer, verifies by SMS, and distinguishes confirmation from desktop binding', async () => {
  fixture.session = session
  mount()
  act(() =>
    renderer!.root.findByProps({ accessibilityLabel: '电脑认领码' }).props.onChangeText('ABCD-EFGH')
  )
  await press('查看待认领电脑')
  expect(labels()).toContain('电脑标识：runtime-a')
  expect(fixture.sms).not.toHaveBeenCalled()
  await press('发送验证码到绑定手机号')
  expect(labels()).toContain('+86 138****0000')
  act(() =>
    renderer!.root
      .findByProps({ accessibilityLabel: '认领短信验证码' })
      .props.onChangeText('123456')
  )
  await press('验证并确认认领')
  expect(fixture.approve).toHaveBeenCalledOnce()
  expect(labels()).toContain('认领已确认')
  expect(labels()).toContain('请返回电脑端完成绑定')
  await press('查看我的电脑')
  expect(fixture.refresh).toHaveBeenCalledOnce()
  expect(fixture.replace).toHaveBeenCalledWith('/')
})

it('clears the former account claim when switching accounts or signing out', async () => {
  fixture.session = session
  mount()
  act(() =>
    renderer!.root.findByProps({ accessibilityLabel: '电脑认领码' }).props.onChangeText('ABCD-EFGH')
  )
  await press('查看待认领电脑')
  fixture.session = { ...session, account: { accountId: 'account-b', displayName: '另一账号' } }
  act(() => renderer!.update(createElement(MobileRuntimeClaimScreen)))
  expect(renderer!.root.findByProps({ accessibilityLabel: '电脑认领码' }).props.value).toBe('')
  expect(labels()).not.toContain('runtime-a')
  fixture.session = null
  act(() => renderer!.update(createElement(MobileRuntimeClaimScreen)))
  expect(renderer!.root.findAllByType('TextInput')).toHaveLength(0)
})
