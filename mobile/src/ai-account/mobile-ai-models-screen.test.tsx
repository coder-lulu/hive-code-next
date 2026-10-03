import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppState } from 'react-native'
import { MobileAiCloudUnauthorizedError } from './mobile-ai-cloud-error'
import MobileAiModelsScreen from './mobile-ai-models-screen'
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  foreground: (_state: string) => {}
}))
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, callback: (state: string) => void) => {
      mocks.foreground = (state) => {
        AppState.currentState = state as typeof AppState.currentState
        callback(state)
      }
      return { remove: vi.fn() }
    }
  }
}))
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  useRouter: () => ({ push: mocks.push, back: vi.fn(), canGoBack: () => true })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24 })
}))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'Icon', ChevronRight: 'Icon' }))
vi.mock('../theme/mobile-theme-provider', async () => ({ useMobileTheme: () => theme }))
vi.mock('./mobile-ai-account-client', () => ({
  readMobileAiModelCandidates: mocks.read
}))
vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ hydrated: true, session: auth, refresh: mocks.refresh })
}))
import { modelCandidatesFixture as catalog } from '../../../src/shared/hive-ai-model-candidates.test-fixture'
import { lightTheme, darkTheme, type MobileTheme } from '../theme/mobile-theme'
let theme: MobileTheme = lightTheme
let auth: { account: { accountId: string }; expiresAt: number } | null
const snapshot = { accountId: 'a', catalog }
let renderer: ReactTestRenderer
beforeEach(() => {
  vi.resetAllMocks()
  AppState.currentState = 'active'
  theme = lightTheme
  auth = { account: { accountId: 'a' }, expiresAt: 4_000_000_000_000 }
  mocks.read.mockResolvedValue(snapshot)
})
afterEach(() => act(() => renderer?.unmount()))
const text = () => JSON.stringify(renderer.toJSON())
const mount = async () => {
  await act(async () => {
    renderer = create(createElement(MobileAiModelsScreen))
  })
}

it('shows reference scope, exact prices, missing cache rates, tiered modes and native theme tokens', async () => {
  await mount()
  expect(text()).toContain('9,007,199,254,740,993.123456789012')
  expect(text()).toContain('基准分组参考价格')
  expect(text()).toContain('分层计费')
  expect(text()).toContain('待上架')
  expect(text()).toContain('—')
  expect(text()).toContain('"paddingBottom":56')
  theme = darkTheme
  act(() => renderer.update(createElement(MobileAiModelsScreen)))
  expect(text()).toContain(darkTheme.color.bg.canvas)
})
it('exposes login without reading model prices when signed out', async () => {
  auth = null
  await mount()
  expect(mocks.read).not.toHaveBeenCalled()
  expect(text()).toContain('登录后可查看 AI 模型与价格')
  act(() => renderer.root.findByProps({ accessibilityLabel: '登录或注册' }).props.onPress())
  expect(mocks.push).toHaveBeenCalledWith('/login')
})
it('cancels background reads and never publishes an old owner catalog', async () => {
  let release!: (value: typeof snapshot) => void
  mocks.read.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve
    })
  )
  await mount()
  const signal = mocks.read.mock.calls[0][1]
  act(() => mocks.foreground('background'))
  expect(signal.aborted).toBe(true)
  auth = { account: { accountId: 'b' }, expiresAt: 4_000_000_000_000 }
  await act(async () => {
    renderer.update(createElement(MobileAiModelsScreen))
    release(snapshot)
  })
  expect(text()).not.toContain('model-plain')
  mocks.read.mockResolvedValue({ ...snapshot, accountId: 'b' })
  await act(async () => mocks.foreground('active'))
  expect(text()).toContain('model-plain')
  expect(mocks.read).toHaveBeenCalledTimes(2)
})
it('bounds unauthorized recovery and keeps manual retry available', async () => {
  mocks.read.mockRejectedValue(new MobileAiCloudUnauthorizedError())
  mocks.refresh.mockImplementation(async () => {
    auth = { ...auth!, expiresAt: 4_000_000_000_001 }
    renderer.update(createElement(MobileAiModelsScreen))
  })
  await mount()
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(mocks.read).toHaveBeenCalledTimes(2)
  expect(text()).toContain('模型价格暂不可用')
  mocks.read.mockResolvedValue({ ...snapshot, catalog: { ...catalog, models: [] } })
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: '刷新 AI 模型价格' }).props.onPress()
  )
  expect(text()).toContain('暂无模型候选')
})
it('disables refresh immediately and delays loading feedback by 300ms', async () => {
  vi.useFakeTimers()
  mocks.read.mockReturnValue(new Promise(() => {}))
  try {
    await mount()
    expect(
      renderer.root.findByProps({ accessibilityLabel: '刷新 AI 模型价格' }).props.disabled
    ).toBe(true)
    expect(text()).not.toContain('正在读取模型价格')
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(text()).toContain('正在读取模型价格')
  } finally {
    vi.useRealTimers()
  }
})

it('implements focus, pressed and disabled actions using semantic theme colors', async () => {
  await mount()
  const action = () => renderer.root.findByProps({ accessibilityLabel: '刷新 AI 模型价格' })
  act(() => action().props.onFocus())
  expect(JSON.stringify(action().props.style({ pressed: false }))).toContain(
    theme.color.brand.primary
  )
  expect(JSON.stringify(action().props.style({ pressed: true }))).toContain(theme.color.bg.subtle)
  act(() => action().props.onBlur())
  expect(JSON.stringify(action().props.style({ pressed: false }))).not.toContain(
    theme.color.brand.primary
  )
})
