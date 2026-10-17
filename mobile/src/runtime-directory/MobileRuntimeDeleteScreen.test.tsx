import { createElement } from 'react'
import { KeyboardAvoidingView, Pressable, Text, TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { darkTheme, lightTheme, type MobileTheme } from '../theme/mobile-theme'
import { MobileRuntimeDeleteScreen } from './MobileRuntimeDeleteScreen'

vi.mock('../auth/mobile-sms-client', () => ({ MobileApiError: class extends Error {} }))

const fixture = vi.hoisted(() => {
  const state: {
    target: string | string[]
    session: {
      authorityId: string
      account: { accountId: string }
      sessionExpiresAt: string
    } | null
    theme: MobileTheme | null
    deletion: Record<string, unknown>
  } = {
    target: '11111111-1111-4111-8111-111111111111',
    session: null,
    theme: null,
    deletion: {}
  }
  return {
    ...state,
    push: vi.fn(),
    replace: vi.fn(),
    hook: vi.fn(),
    review: vi.fn(),
    send: vi.fn(),
    confirm: vi.fn(),
    cleanup: vi.fn()
  }
})
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ runtimeRecordId: fixture.target }),
  useRouter: () => ({ push: fixture.push, replace: fixture.replace, canGoBack: () => false })
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 24 })
}))
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft' }))
vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ hydrated: true, session: fixture.session })
}))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false })
}))
vi.mock('../platform/host-os', () => ({ hostOs: () => 'android' }))
vi.mock('../platform/keyboard-occlusion', () => ({ useKeyboardOcclusion: () => 300 }))
vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => fixture.theme,
  useMobileThemeStyles: (factory: (theme: unknown) => unknown) => factory(fixture.theme)
}))
vi.mock('./use-mobile-runtime-delete', () => ({
  useMobileRuntimeDelete: (...args: unknown[]) => {
    fixture.hook(...args)
    return fixture.deletion
  }
}))

let renderer: ReactTestRenderer | null = null
function mount() {
  act(() => {
    renderer = create(createElement(MobileRuntimeDeleteScreen))
  })
}
function button(label: string) {
  return renderer!.root
    .findAll((node) => node.type === Pressable)
    .find((node) => node.props.accessibilityLabel === label)!
}
function text() {
  return renderer!.root
    .findAll((node) => node.type === Text)
    .map((node) => node.children.join(''))
    .join('\n')
}
beforeEach(() => {
  vi.clearAllMocks()
  fixture.target = '11111111-1111-4111-8111-111111111111'
  fixture.session = {
    authorityId: 'authority',
    account: { accountId: 'account' },
    sessionExpiresAt: 'expiry'
  }
  fixture.theme = lightTheme
  fixture.deletion = {
    entry: { runtimeRecordId: fixture.target, deviceName: '我的电脑', cloudDisplayName: null },
    superseded: false,
    loading: false,
    busy: false,
    canSubmit: false,
    sms: null,
    smsExpired: false,
    resendRemaining: 0,
    confirmationName: '',
    smsCode: '',
    setConfirmationName: vi.fn(),
    setSmsCode: vi.fn(),
    review: fixture.review,
    sendSms: fixture.send,
    confirm: fixture.confirm,
    retryCleanup: fixture.cleanup
  }
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

it.each([lightTheme, darkTheme])(
  'renders themed scrollable confirmation with safe areas and keyboard avoidance',
  (theme) => {
    fixture.theme = theme
    mount()
    expect(text()).toContain('电脑上的项目和会话数据会保留')
    expect(button('验证并删除 Runtime').props.disabled).toBe(true)
    expect(
      renderer!.root.find((node) => node.type === KeyboardAvoidingView).props.style
    ).toContainEqual({
      marginBottom: 276
    })
    expect(renderer!.root.findAll((node) => node.type === SafeAreaView)[0].props.edges).toEqual([
      'bottom',
      'left',
      'right'
    ])
    for (const node of renderer!.root.findAll((node) => node.type === Text)) {
      expect(node.props.maxFontSizeMultiplier).toBe(1.3)
    }
    expect(renderer!.root.find((node) => node.type === TextInput).props.editable).toBe(true)
  }
)

it('never mounts the destructive hook for invalid or repeated IDs', () => {
  fixture.target = ['11111111-1111-4111-8111-111111111111']
  mount()
  expect(text()).toContain('Runtime 标识无效')
  expect(fixture.hook).not.toHaveBeenCalled()
})
it('requires authentication before mounting deletion', () => {
  fixture.session = null
  mount()
  act(() => button('登录 HiveCloud').props.onPress())
  expect(fixture.push).toHaveBeenCalledWith('/login')
  expect(fixture.hook).not.toHaveBeenCalled()
})
it('offers result review only after an uncertain write', () => {
  Object.assign(fixture.deletion, { uncertain: true })
  mount()
  expect(renderer!.root.findAll((node) => node.type === TextInput)).toHaveLength(0)
  expect(button('验证并删除 Runtime')).toBeUndefined()
  act(() => button('核对删除结果').props.onPress())
  expect(fixture.review).toHaveBeenCalledOnce()
})
it('offers cleanup retry without another SMS or unlink action after cloud confirmation', () => {
  Object.assign(fixture.deletion, { cloudConfirmed: true, error: '本机存储不可用' })
  mount()
  act(() => button('重试清理本机记录').props.onPress())
  expect(fixture.cleanup).toHaveBeenCalledOnce()
  expect(button('验证并删除 Runtime')).toBeUndefined()
  expect(text()).toContain('本机存储不可用')
})
it('shows completed success and returns home', () => {
  Object.assign(fixture.deletion, { completed: true, cloudConfirmed: true })
  mount()
  act(() => button('返回首页').props.onPress())
  expect(fixture.replace).toHaveBeenCalledWith('/')
  expect(button('重试清理本机记录')).toBeUndefined()
})
it('disables expired SMS input and daily-limited resend while keeping errors visible', () => {
  Object.assign(fixture.deletion, {
    sms: { phoneNumberMasked: '138****1234' },
    smsExpired: true,
    smsDailyLimited: true
  })
  mount()
  expect(button('今日短信次数已用完').props.disabled).toBe(true)
  const sms = renderer!.root
    .findAll((node) => node.type === TextInput)
    .find((node) => node.props.accessibilityLabel === '删除 Runtime 短信验证码')!
  expect(sms.props.editable).toBe(false)
  expect(text()).toContain('验证码已过期')
})
it('does not show mutation controls on unsupported surfaces', () => {
  Object.assign(fixture.deletion, { unsupported: true })
  mount()
  expect(text()).toContain('请在手机 APP 中删除')
  expect(button('验证并删除 Runtime')).toBeUndefined()
})

it('connects enabled confirmation and SMS actions to the controller', () => {
  Object.assign(fixture.deletion, { canSubmit: true })
  mount()
  expect(button('验证并删除 Runtime').props.disabled).toBe(false)
  act(() => button('发送验证码到绑定手机号').props.onPress())
  act(() => button('验证并删除 Runtime').props.onPress())
  expect(fixture.send).toHaveBeenCalledOnce()
  expect(fixture.confirm).toHaveBeenCalledOnce()
})

it('locks inputs and mutation controls while busy and offers re-login when required', () => {
  Object.assign(fixture.deletion, { busy: true, requiresLogin: true })
  mount()
  expect(renderer!.root.find((node) => node.type === TextInput).props.editable).toBe(false)
  expect(button('发送验证码到绑定手机号').props.disabled).toBe(true)
  expect(button('正在处理…').props.disabled).toBe(true)
  act(() => button('重新登录').props.onPress())
  expect(fixture.push).toHaveBeenCalledWith('/login')
})

it('preserves current-connection messaging when a completed deletion was superseded', () => {
  Object.assign(fixture.deletion, { completed: true, superseded: true })
  mount()
  expect(text()).toContain(
    '此 Runtime 的认领或删除操作已更新，已保留当前连接。请返回列表查看最新状态。'
  )
  expect(text()).not.toContain('本机连接记录已清理')
  expect(button('验证并删除 Runtime')).toBeUndefined()
  act(() => button('返回首页').props.onPress())
  expect(fixture.replace).toHaveBeenCalledWith('/')
})
