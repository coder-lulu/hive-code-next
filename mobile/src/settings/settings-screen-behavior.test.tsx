import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsScreen from '../../app/settings'
import { productNameText } from '../product-brand'

const dependencies = vi.hoisted(() => ({
  updateState: 'idle',
  checkUpdate: vi.fn(),
  back: vi.fn(),
  canGoBack: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  loadCleanup: vi.fn(),
  retryCleanup: vi.fn(),
  setThemePreference: vi.fn(),
  unsubscribe: vi.fn()
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))

vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect(effect: () => void | (() => void)): void {
      React.useEffect(effect, [effect])
    },
    useRouter: () => ({
      back: dependencies.back,
      canGoBack: dependencies.canGoBack,
      push: dependencies.push,
      replace: dependencies.replace
    })
  }
})

vi.mock('lucide-react-native', () => {
  const iconNames = [
    'Bell',
    'ChevronLeft',
    'ChevronRight',
    'Database',
    'Globe',
    'Info',
    'KeyRound',
    'Languages',
    'LifeBuoy',
    'LogIn',
    'MessageSquare',
    'Mic',
    'MonitorDown',
    'MonitorSmartphone',
    'Palette',
    'RefreshCw',
    'Scale',
    'Shield',
    'Terminal',
    'UserRound',
    'Wrench'
  ]
  return Object.fromEntries(iconNames.map((name) => [name, name]))
})

vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } =
    await vi.importActual<typeof import('../theme/mobile-theme')>('../theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemePreference: () => ({
      hydrated: true,
      preference: 'system',
      setPreference: dependencies.setThemePreference
    })
  }
})

vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ hydrated: true, session: null })
}))

vi.mock('../update/use-mobile-update', () => ({
  useMobileUpdate: () => ({
    snapshot: { state: dependencies.updateState },
    checkNow: dependencies.checkUpdate,
    install: vi.fn()
  })
}))

vi.mock('../transport/host-credential-cleanup', () => ({
  loadPendingHostCredentialCleanup: dependencies.loadCleanup,
  subscribePendingHostCredentialCleanup: () => dependencies.unsubscribe
}))

vi.mock('../transport/host-store', () => ({
  retryPendingHostCredentialCleanup: dependencies.retryCleanup
}))

async function renderSettings(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(SettingsScreen))
    await Promise.resolve()
    await Promise.resolve()
  })
  if (!renderer) {
    throw new Error('Settings route did not render')
  }
  return renderer
}

function pressableForText(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const label = renderer.root
    .findAllByType('Text')
    .find((node) => node.children.filter((child) => typeof child === 'string').join('') === text)
  if (!label) {
    throw new Error(`Missing settings label: ${text}`)
  }
  let current: ReactTestInstance | null = label
  while (current && current.type !== 'Pressable') {
    current = current.parent
  }
  if (!current) {
    throw new Error(`Settings label is not actionable: ${text}`)
  }
  return current
}

describe('settings screen behavior', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    dependencies.updateState = 'idle'
    dependencies.checkUpdate.mockReset()
    dependencies.back.mockReset()
    dependencies.canGoBack.mockReset().mockReturnValue(true)
    dependencies.replace.mockReset()
    dependencies.push.mockReset()
    dependencies.unsubscribe.mockReset()
    dependencies.loadCleanup.mockReset().mockResolvedValue({ ids: [], storageUnreadable: false })
    dependencies.retryCleanup
      .mockReset()
      .mockResolvedValue({ remainingIds: [], storageUnreadable: false })
    dependencies.setThemePreference.mockReset().mockResolvedValue(true)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('allows reopening background download progress from settings', async () => {
    dependencies.updateState = 'downloading'
    renderer = await renderSettings()
    const row = pressableForText(renderer, '检查更新')
    expect(row.props.disabled).not.toBe(true)
    act(() => row.props.onPress())
    expect(dependencies.checkUpdate).toHaveBeenCalledOnce()
  })

  it.each([
    ['AI 额度与用量', '/ai-account'],
    ['AI 模型与价格', '/ai-models'],
    ['终端', '/terminal-settings'],
    ['聊天界面', '/native-chat-settings'],
    ['浏览器', '/browser-settings'],
    ['语音', '/voice-settings'],
    ['通知', '/notifications'],
    ['故障排查', '/troubleshoot'],
    [productNameText('关于 Orca'), '/about']
  ])('preserves the %s navigation target', async (label, route) => {
    renderer = await renderSettings()

    act(() => pressableForText(renderer!, label).props.onPress())

    expect(dependencies.push).toHaveBeenCalledWith(route)
  })

  it('returns to the previous screen or home when opened directly', async () => {
    renderer = await renderSettings()
    act(() => renderer!.root.findByProps({ accessibilityLabel: '返回' }).props.onPress())
    expect(dependencies.back).toHaveBeenCalledOnce()

    dependencies.canGoBack.mockReturnValue(false)
    act(() => renderer!.root.findByProps({ accessibilityLabel: '返回' }).props.onPress())
    expect(dependencies.replace).toHaveBeenCalledWith('/')
  })

  it('persists an explicit appearance preference instead of faking a visual toggle', async () => {
    renderer = await renderSettings()
    const options = renderer.root.findAllByProps({
      accessibilityRole: 'radio'
    })
    const dark = options.find((option) =>
      option.findAllByType('Text').some((text) => text.children.includes('深色'))
    )
    expect(dark).toBeDefined()

    await act(async () => {
      await dark!.props.onPress()
    })

    expect(dependencies.setThemePreference).toHaveBeenCalledWith('dark')
  })

  it.each([
    [productNameText('Orca 账号'), '/account'],
    ['登录与注册', '/login'],
    ['帮助与反馈', '/feedback'],
    ['隐私中心', '/privacy'],
    ['服务协议', { pathname: '/legal', params: { document: 'terms' } }],
    ['隐私政策', { pathname: '/legal', params: { document: 'privacy' } }],
    ['存储空间', '/storage']
  ])('routes %s to its truthful future UI', async (label, route) => {
    renderer = await renderSettings()

    act(() => pressableForText(renderer!, label as string).props.onPress())

    expect(dependencies.push).toHaveBeenCalledWith(route)
  })

  it('retries pending credential cleanup without hiding the recovery action', async () => {
    dependencies.loadCleanup.mockResolvedValue({
      ids: ['host-1'],
      storageUnreadable: false
    })
    dependencies.retryCleanup.mockResolvedValue({
      remainingIds: ['host-1'],
      storageUnreadable: false
    })
    renderer = await renderSettings()
    const retry = renderer.root.findByProps({
      accessibilityLabel: 'Retry clearing pairing credentials'
    })

    await act(async () => {
      await retry.props.onPress()
    })

    expect(dependencies.retryCleanup).toHaveBeenCalledOnce()
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: 'Retry clearing pairing credentials'
      })
    ).toHaveLength(1)
  })

  it('registers every future route without consumer credit UI', () => {
    const layoutSource = readFileSync(
      fileURLToPath(new URL('../../app/_layout.tsx', import.meta.url)),
      'utf8'
    )
    const settingsSource = readFileSync(
      fileURLToPath(new URL('../../app/settings.tsx', import.meta.url)),
      'utf8'
    )
    for (const routeName of [
      'account',
      'account/delete',
      'login',
      'privacy',
      'legal',
      'feedback',
      'storage'
    ]) {
      expect(layoutSource).toContain(`name="${routeName}"`)
    }
    expect(`${layoutSource}\n${settingsSource}`).not.toMatch(
      /积分|consumerCredits|consumer credit/i
    )
  })
})
