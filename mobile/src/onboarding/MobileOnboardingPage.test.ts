import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkTheme, lightTheme, type MobileTheme } from '../theme/mobile-theme'
import { MobileOnboardingPage } from './MobileOnboardingPage'

const mocks = vi.hoisted(() => ({ theme: undefined as MobileTheme | undefined }))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: unknown }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: 'Text',
    View: 'View'
  }
})

vi.mock('lucide-react-native', () => ({
  BellRing: 'BellRing',
  MessageSquare: 'MessageSquare'
}))

vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme: defaultTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => mocks.theme ?? defaultTheme,
    useMobileThemeStyles: (factory: (theme: MobileTheme) => unknown) =>
      factory(mocks.theme ?? defaultTheme)
  }
})

describe('MobileOnboardingPage', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    mocks.theme = lightTheme
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  async function renderPage(
    step: 'session-view' | 'notifications',
    options: { active?: boolean; busyChoice?: 'chat' | 'enable' | null } = {}
  ) {
    const onSessionChoice = vi.fn()
    const onNotificationChoice = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
        throw new Error(String(args[0]))
      }
    })
    await act(async () => {
      renderer = create(
        createElement(MobileOnboardingPage, {
          step,
          width: 390,
          active: options.active ?? true,
          busyChoice: options.busyChoice ?? null,
          error: null,
          onSessionChoice,
          onNotificationChoice
        })
      )
    })
    consoleError.mockRestore()
    return { onSessionChoice, onNotificationChoice }
  }

  function button(label: string) {
    return renderer!.root.find(
      (node) => node.type === 'Pressable' && node.props.accessibilityLabel === label
    )
  }

  it('renders the session choices and sends exactly one selected view', async () => {
    const callbacks = await renderPage('session-view')

    act(() => button('默认使用聊天界面打开会话').props.onPress())
    expect(callbacks.onSessionChoice).toHaveBeenCalledWith('chat')
    expect(callbacks.onNotificationChoice).not.toHaveBeenCalled()
  })

  it('renders the notification choices and sends the selected option', async () => {
    const callbacks = await renderPage('notifications')
    act(() => button('暂不开启 Agent 通知').props.onPress())

    expect(callbacks.onNotificationChoice).toHaveBeenCalledWith('skip')
    expect(callbacks.onSessionChoice).not.toHaveBeenCalled()
  })

  it('disables both notification choices while permission is pending', async () => {
    await renderPage('notifications', { busyChoice: 'enable' })
    const enable = button('开启 Agent 通知')
    const secondary = button('暂不开启 Agent 通知')

    expect(enable.props.disabled).toBe(true)
    expect(enable.props.accessibilityState).toEqual({ busy: true, disabled: true })
    expect(secondary.props.disabled).toBe(true)
    expect(secondary.props.accessibilityState).toEqual({ busy: false, disabled: true })
  })

  it('uses Chinese copy, semantic hierarchy, and bounded font scaling', async () => {
    await renderPage('session-view')
    const title = renderer!.root.find(
      (node) => node.type === 'Text' && node.children.join('') === '选择会话打开方式'
    )
    const body = renderer!.root.find(
      (node) =>
        node.type === 'Text' &&
        node.children.join('').includes('选择此设备上的 Agent 会话默认在终端或聊天界面中打开')
    )

    expect(title.props).toMatchObject({ accessibilityRole: 'header', maxFontSizeMultiplier: 1.3 })
    expect(body.props.maxFontSizeMultiplier).toBe(1.3)
  })

  it('updates semantic colors for dark mode', async () => {
    mocks.theme = darkTheme
    await renderPage('session-view', { busyChoice: 'chat' })
    const icon = renderer!.root.findByType('MessageSquare')
    const spinner = renderer!.root.findByType('ActivityIndicator')

    expect(icon.props).toMatchObject({
      color: darkTheme.color.text.primary,
      size: 24,
      strokeWidth: 2
    })
    expect(spinner.props.color).toBe(darkTheme.color.text.inverse)
  })

  it('hides an off-screen page from assistive technology', async () => {
    await renderPage('notifications', { active: false })
    const scrollView = renderer!.root.findByType('ScrollView')

    expect(scrollView.props.accessibilityElementsHidden).toBe(true)
    expect(scrollView.props.importantForAccessibility).toBe('no-hide-descendants')
  })
})
