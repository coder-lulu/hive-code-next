import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppState } from 'react-native'
import { MobileAiCloudUnauthorizedError } from './mobile-ai-cloud-error'
import MobileAiAccountScreen from './mobile-ai-account-screen'
import { aiBenefitsFixture } from '../../../src/shared/hive-ai-benefits.test-fixture'
import { consumptionPageFixture } from '../../../src/shared/hive-ai-consumption.test-fixture'
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  benefits: vi.fn(),
  activate: vi.fn(),
  consumption: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  stateListeners: new Set<(state: string) => void>(),
  foreground: (_state: string) => {}
}))
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  Keyboard: { dismiss: vi.fn() },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, callback: (state: string) => void) => {
      mocks.stateListeners.add(callback)
      mocks.foreground = (state) => {
        AppState.currentState = state as typeof AppState.currentState
        mocks.stateListeners.forEach((listener) => listener(state))
      }
      return { remove: () => mocks.stateListeners.delete(callback) }
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
vi.mock('../theme/mobile-theme-provider', async () => ({
  useMobileTheme: () => theme,
  useMobileThemeStyles: (factory: (value: MobileTheme) => unknown) => factory(theme)
}))
vi.mock('./mobile-ai-consumption-client', () => ({ readMobileAiConsumption: mocks.consumption }))
vi.mock('./mobile-ai-account-client', () => ({
  activateMobileAiAccount: mocks.activate,
  readMobileAiAccount: mocks.read,
  readMobileAiBenefits: mocks.benefits
}))
vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ hydrated: true, session: auth, refresh: mocks.refresh })
}))
import { lightTheme, darkTheme, type MobileTheme } from '../theme/mobile-theme'
let theme: MobileTheme = lightTheme
let auth: { account: { accountId: string }; expiresAt: number } | null
const snapshot = {
  accountId: 'a',
  account: { status: 'ACTIVE' },
  balance: {
    accountStatus: 'ACTIVE',
    availableQuota: '9007199254740993',
    usedQuota: '0',
    requestCount: '1',
    freshness: 'CURRENT',
    asOf: '2026-09-13T00:00:00Z'
  }
}
let renderer: ReactTestRenderer
beforeEach(() => {
  vi.resetAllMocks()
  mocks.stateListeners.clear()
  AppState.currentState = 'active'
  theme = lightTheme
  auth = { account: { accountId: 'a' }, expiresAt: 4_000_000_000_000 }
  mocks.read.mockResolvedValue(snapshot)
  mocks.consumption.mockResolvedValue({ accountId: 'a', history: null })
  mocks.benefits.mockResolvedValue({
    accountId: 'a',
    account: snapshot.account,
    benefits: aiBenefitsFixture
  })
})
afterEach(() => act(() => renderer?.unmount()))
const text = () => JSON.stringify(renderer.toJSON())
const mount = async () => {
  await act(async () => {
    renderer = create(createElement(MobileAiAccountScreen))
  })
}

const consumptionButton = (label: string) =>
  renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => node.props.accessibilityLabel === label)!
it('queries and pages consumption using committed filters and exact integers', async () => {
  mocks.consumption.mockImplementation(async (_session, query) => ({
    accountId: 'a',
    history: { ...consumptionPageFixture, ...query, reportedTotal: '21' }
  }))
  await mount()
  expect(text()).toContain('9,223,372,036,854,775,807')
  const initial = mocks.consumption.mock.calls[0][1]
  expect(Date.parse(initial.to) - Date.parse(initial.from)).toBe(7 * 86400000)
  await act(async () => consumptionButton('近 30 天').props.onPress())
  const selected = mocks.consumption.mock.calls.at(-1)![1]
  expect(Date.parse(selected.to) - Date.parse(selected.from)).toBe(30 * 86400000)
  const field = renderer.root
    .findAllByType('TextInput' as never)
    .find((node) => node.props.accessibilityLabel === '模型（精确名称）')!
  act(() => field.props.onChangeText('model/a'))
  await act(async () => consumptionButton('下一页').props.onPress())
  expect(mocks.consumption.mock.calls.at(-1)?.[1]).toMatchObject({ page: 2 })
  expect(mocks.consumption.mock.calls.at(-1)?.[1].model).toBeUndefined()
  expect(consumptionButton('下一页').props.disabled).toBe(true)
  await act(async () => consumptionButton('查询记录').props.onPress())
  expect(mocks.consumption.mock.calls.at(-1)?.[1]).toMatchObject({ page: 1, model: 'model/a' })
  act(() => field.props.onChangeText('*'))
  const before = mocks.consumption.mock.calls.length
  await act(async () => consumptionButton('查询记录').props.onPress())
  expect(mocks.consumption).toHaveBeenCalledTimes(before)
  expect(text()).toContain('请选择不超过 31 天')
  expect(text()).not.toContain('9,223,372,036,854,775,807')
})
it('clears consumption on background and discards late query results after logout', async () => {
  mocks.consumption.mockImplementation(async (_session, query) => ({
    accountId: 'a',
    history: { ...consumptionPageFixture, ...query, reportedTotal: '21' }
  }))
  await mount()
  act(() => mocks.foreground('background'))
  expect(text()).not.toContain('9,223,372,036,854,775,807')
  await act(async () => mocks.foreground('active'))
  expect(text()).toContain('9,223,372,036,854,775,807')
  let finish!: (value: unknown) => void
  mocks.consumption.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await act(async () => consumptionButton('下一页').props.onPress())
  const call = mocks.consumption.mock.calls.at(-1)!
  auth = null
  act(() => renderer.update(createElement(MobileAiAccountScreen)))
  expect(call[2].aborted).toBe(true)
  await act(async () =>
    finish({ accountId: 'a', history: { ...consumptionPageFixture, ...call[1] } })
  )
  expect(text()).not.toContain('9,223,372,036,854,775,807')
})
it('distinguishes unavailable records from an empty range', async () => {
  mocks.consumption.mockRejectedValueOnce(new Error('unavailable'))
  await mount()
  expect(text()).toContain('消费记录暂不可用')
  expect(text()).not.toContain('所选范围暂无消费记录')
  mocks.consumption.mockImplementationOnce(async (_session, query) => ({
    accountId: 'a',
    history: { ...consumptionPageFixture, ...query, reportedTotal: '0', entries: [] }
  }))
  await act(async () => consumptionButton('查询记录').props.onPress())
  expect(text()).toContain('所选范围暂无消费记录')
  expect(consumptionButton('下一页').props.disabled).toBe(true)
})

it('shows exact credits, units, safe-area padding and theme changes', async () => {
  await mount()
  expect(text()).toContain('9,007,199,254,740,993')
  expect(text()).toContain('1 积分 = 1 New API 额度单位。积分不是货币金额')
  expect(text()).toContain('"paddingBottom":56')
  theme = darkTheme
  act(() => renderer.update(createElement(MobileAiAccountScreen)))
  expect(text()).toContain(darkTheme.color.bg.canvas)
})
it('clears balances on sign-out and exposes login without Cloud reads', async () => {
  await mount()
  auth = null
  act(() => renderer.update(createElement(MobileAiAccountScreen)))
  expect(text()).not.toContain('9,007,199,254,740,993')
  expect(text()).toContain('登录后可查看')
  expect(mocks.read).toHaveBeenCalledTimes(1)
})

const inactive = (status = 'NOT_PROVISIONED') => ({
  accountId: 'a',
  account: { status, activationAvailable: true },
  balance: null
})
const activationButton = () =>
  renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => ['一键开通', '核实开通结果'].includes(node.props.accessibilityLabel))!

it('opens explicitly, blocks repeated clicks and refreshes verified wallet and benefits', async () => {
  let finish!: (value: unknown) => void
  mocks.read.mockResolvedValueOnce(inactive()).mockResolvedValue(snapshot)
  mocks.benefits.mockResolvedValueOnce({ ...inactive(), benefits: null })
  mocks.activate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await mount()
  const button = activationButton()
  expect(button.props.accessibilityLabel).toBe('一键开通')
  act(() => {
    button.props.onPress()
    button.props.onPress()
  })
  expect(activationButton().props.disabled).toBe(true)
  expect(mocks.activate).toHaveBeenCalledOnce()
  expect(mocks.read).toHaveBeenCalledOnce()
  await act(async () => finish({ accountId: 'a', account: snapshot.account }))
  expect(text()).toContain('9,007,199,254,740,993')
  expect(mocks.read).toHaveBeenCalledTimes(2)
  expect(mocks.benefits).toHaveBeenCalledTimes(2)
  expect(activationButton()).toBeUndefined()
})

it('shows UNKNOWN verification after an uncertain activation without automatically repeating it', async () => {
  mocks.read.mockResolvedValueOnce(inactive()).mockResolvedValue(inactive('UNKNOWN'))
  mocks.benefits.mockResolvedValue({ ...inactive(), benefits: null })
  mocks.activate.mockRejectedValue(new Error('uncertain'))
  await mount()
  await act(async () => activationButton().props.onPress())
  expect(text()).toContain('未能确认开通请求结果')
  expect(activationButton().props.accessibilityLabel).toBe('核实开通结果')
  expect(mocks.activate).toHaveBeenCalledOnce()
  expect(mocks.read).toHaveBeenCalledTimes(2)
})

it.each([false, true])(
  'refreshes plans independently of a stalled post-activation wallet (uncertain=%s)',
  async (uncertain) => {
    let rejectWallet!: (error: Error) => void
    mocks.read.mockResolvedValueOnce(inactive()).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectWallet = reject
        })
    )
    mocks.benefits.mockResolvedValueOnce({ ...inactive(), benefits: null })
    if (uncertain) {
      mocks.activate.mockRejectedValue(new Error('lost response'))
    }
    await mount()
    await act(async () => activationButton().props.onPress())
    expect(mocks.benefits).toHaveBeenCalledTimes(2)
    expect(text()).toContain('Monthly')
    expect(text()).toContain('vip')
    expect(renderer.root.findByProps({ accessibilityLabel: '刷新 AI 积分' }).props.disabled).toBe(
      true
    )
    expect(mocks.activate).toHaveBeenCalledOnce()
    await act(async () => rejectWallet(new Error('wallet unavailable')))
    expect(text()).toContain('Monthly')
    expect(renderer.root.findByProps({ accessibilityLabel: '刷新 AI 积分' }).props.disabled).toBe(
      false
    )
  }
)

it('aborts activation on logout, ignores its late result and does not read the old account again', async () => {
  let finish!: (value: unknown) => void
  mocks.read.mockResolvedValue(inactive())
  mocks.benefits.mockResolvedValue({ ...inactive(), benefits: null })
  mocks.activate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await mount()
  act(() => activationButton().props.onPress())
  const signal = mocks.activate.mock.calls[0][1]
  auth = null
  act(() => renderer.update(createElement(MobileAiAccountScreen)))
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ accountId: 'a', account: snapshot.account }))
  expect(mocks.read).toHaveBeenCalledOnce()
  expect(mocks.benefits).toHaveBeenCalledOnce()
  expect(text()).not.toContain('未能确认开通请求结果')
  expect(text()).toContain('登录后可查看')
})
it('cancels background reads, refreshes on foreground, and discards previous owner results', async () => {
  let release!: (value: typeof snapshot) => void
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  await mount()
  const signal = mocks.read.mock.calls[0][1]
  act(() => mocks.foreground('background'))
  expect(signal.aborted).toBe(true)
  auth = { account: { accountId: 'b' }, expiresAt: 4_000_000_000_000 }
  mocks.read.mockRejectedValue(new Error('offline'))
  await act(async () => {
    renderer.update(createElement(MobileAiAccountScreen))
    release(snapshot)
  })
  expect(text()).not.toContain('9,007,199,254,740,993')
  expect(mocks.read).toHaveBeenCalledTimes(1)
  const calls = mocks.read.mock.calls.length
  await act(async () => mocks.foreground('active'))
  expect(mocks.read.mock.calls.length).toBe(calls + 1)
})
it('distinguishes zero from unavailable and keeps refresh usable after failure', async () => {
  mocks.read.mockResolvedValue({
    ...snapshot,
    balance: { ...snapshot.balance, availableQuota: '0' }
  })
  await mount()
  expect(text()).toContain('钱包积分余额不足；套餐积分单独核算。')
  mocks.read.mockRejectedValue(new Error('offline'))
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: '刷新 AI 积分' }).props.onPress()
  )
  expect(text()).not.toContain('钱包积分余额不足')
  expect(renderer.root.findByProps({ accessibilityLabel: '刷新 AI 积分' }).props.disabled).toBe(
    false
  )
})

it('refreshes a rejected session once and stops repeated 401 refresh loops', async () => {
  mocks.read.mockRejectedValue(new MobileAiCloudUnauthorizedError())
  mocks.refresh.mockImplementation(async () => {
    auth = { ...auth!, expiresAt: 4_000_000_000_001 }
    renderer.update(createElement(MobileAiAccountScreen))
  })
  await mount()
  expect(mocks.refresh).toHaveBeenCalledTimes(1)
  expect(mocks.read).toHaveBeenCalledTimes(2)
  expect(text()).toContain('钱包积分暂不可用')
})
it('shows login when session recovery rejects the session', async () => {
  mocks.read.mockRejectedValue(new MobileAiCloudUnauthorizedError())
  mocks.refresh.mockImplementation(async () => {
    auth = null
    renderer.update(createElement(MobileAiAccountScreen))
    throw new Error('session rejected')
  })
  await mount()
  expect(mocks.refresh).toHaveBeenCalledTimes(1)
  expect(text()).toContain('登录后可查看')
})
it('does not refresh a replacement owner for a stale unauthorized result', async () => {
  let reject!: (error: Error) => void
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      })
  )
  await mount()
  auth = { account: { accountId: 'b' }, expiresAt: 4_000_000_000_000 }
  await act(async () => renderer.update(createElement(MobileAiAccountScreen)))
  await act(async () => reject(new MobileAiCloudUnauthorizedError()))
  expect(mocks.refresh).not.toHaveBeenCalled()
})
it('does not read when initially backgrounded or manually refreshed in background', async () => {
  AppState.currentState = 'background'
  await mount()
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: '刷新 AI 积分' }).props.onPress()
  )
  expect(mocks.read).not.toHaveBeenCalled()
  await act(async () => mocks.foreground('active'))
  expect(mocks.read).toHaveBeenCalledTimes(1)
})

it('allows manual recovery after a transient refresh failure', async () => {
  mocks.read.mockRejectedValue(new MobileAiCloudUnauthorizedError())
  mocks.refresh.mockRejectedValue(new Error('offline'))
  await mount()
  expect(mocks.refresh).toHaveBeenCalledTimes(1)
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: '刷新 AI 积分' }).props.onPress()
  )
  expect(mocks.refresh).toHaveBeenCalledTimes(2)
})

it('shows group, finite and unlimited plans with exact points even if wallet reads fail', async () => {
  mocks.read.mockRejectedValue(new Error('offline'))
  await mount()
  expect(text()).toContain('vip')
  expect(text()).toContain('Monthly')
  expect(text()).toContain('9,007,199,254,740,986')
  expect(text()).toContain('#8')
  expect(text()).toContain('已过期')
  expect(text()).toContain('不限量')
  expect(text()).toContain('钱包积分暂不可用')
})
it('keeps wallet visible when plans fail and distinguishes unavailable from empty plans', async () => {
  mocks.benefits.mockRejectedValue(new Error('offline'))
  await mount()
  expect(text()).toContain('9,007,199,254,740,993')
  expect(text()).toContain('套餐信息暂不可用')
  expect(text()).not.toContain('暂无套餐')
})
it('hides all confirmed values when either independent read reports a disabled account', async () => {
  mocks.benefits.mockResolvedValue({
    accountId: 'a',
    account: { status: 'DISABLED' },
    benefits: null
  })
  await mount()
  expect(text()).toContain('AI 账户已停用')
  expect(text()).not.toContain('9,007,199,254,740,993')
  expect(text()).not.toContain('Monthly')
})
it('keeps wallets visible while benefits stall and cancels benefits on sign-out', async () => {
  mocks.benefits.mockImplementation(() => new Promise(() => {}))
  await mount()
  expect(text()).toContain('9,007,199,254,740,993')
  const signal = mocks.benefits.mock.calls[0][1]
  auth = null
  act(() => renderer.update(createElement(MobileAiAccountScreen)))
  expect(signal.aborted).toBe(true)
  expect(text()).not.toContain('9,007,199,254,740,993')
})

it.each([
  ['DISABLED', 'AI 账户已停用，请联系支持。'],
  ['NOT_PROVISIONED', 'AI 账户尚未开通，开通服务暂不可用。'],
  ['PENDING', 'AI 账户正在准备，请稍后刷新。'],
  ['UNKNOWN', 'AI 账户状态待核对，请稍后刷新或联系支持。']
])('shows known %s immediately while the other read stalls', async (status, message) => {
  for (const stalled of ['wallet', 'benefits']) {
    mocks.read.mockResolvedValue({ ...snapshot, account: { status }, balance: null })
    mocks.benefits.mockResolvedValue({ accountId: 'a', account: { status }, benefits: null })
    const stalledRead = stalled === 'wallet' ? mocks.read : mocks.benefits
    stalledRead.mockImplementation(() => new Promise(() => {}))
    await mount()
    expect(text()).toContain(message)
    expect(text()).not.toContain('正在读取 AI 账户')
    expect(text()).not.toContain('9,007,199,254,740,993')
    expect(renderer.root.findByProps({ accessibilityLabel: '刷新 AI 积分' }).props.disabled).toBe(
      true
    )
    act(() => renderer.unmount())
  }
})
