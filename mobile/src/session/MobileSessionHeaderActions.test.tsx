import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkTheme, lightTheme, type MobileTheme } from '../theme/mobile-theme'
import { MobileBrowserTabActionSheet } from './MobileBrowserTabActionSheet'
import { MobileSessionHeaderIconButton } from './MobileSessionHeaderIconButton'
import { MobileSessionHeaderMoreActionsSheet } from './MobileSessionHeaderMoreActionsSheet'

const mocks = vi.hoisted(() => ({ theme: undefined as MobileTheme | undefined }))

vi.mock('react-native', () => ({
  Platform: { select: (options: { default?: unknown }) => options.default },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFillObject: {},
    create: (styles: unknown) => styles,
    hairlineWidth: 1
  }
}))

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  ListChecks: 'ListChecks',
  RefreshCw: 'RefreshCw'
}))

vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: 'ActionSheetModal' }))
vi.mock('../agent-history/MobileAgentSessionHistoryIcon', () => ({
  MobileAgentSessionHistoryIcon: 'MobileAgentSessionHistoryIcon'
}))
vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme: defaultTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => mocks.theme ?? defaultTheme,
    useMobileThemeStyles: (factory: (theme: MobileTheme) => unknown) =>
      factory(mocks.theme ?? defaultTheme)
  }
})

function flattenStyle(style: unknown): Record<string, unknown> {
  const entries = Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]
  return Object.assign({}, ...entries)
}

describe('Mobile Session header actions', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    mocks.theme = lightTheme
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps the header action callback and exposes a 44dp selected button', async () => {
    mocks.theme = darkTheme
    const onPress = vi.fn()
    const HeaderIcon = (props: Record<string, unknown>) => createElement('HeaderIcon', props)
    await act(async () => {
      renderer = create(
        createElement(MobileSessionHeaderIconButton, {
          active: true,
          accessibilityLabel: '打开文件浏览器',
          icon: HeaderIcon,
          onPress
        })
      )
    })
    const button = renderer!.root.findByType('Pressable')
    const icon = renderer!.root.findByType('HeaderIcon')
    const restStyle = flattenStyle(button.props.style({ pressed: false }))

    expect(button.props).toMatchObject({
      accessibilityLabel: '打开文件浏览器',
      accessibilityRole: 'button',
      accessibilityState: { selected: true }
    })
    expect(restStyle).toMatchObject({ minHeight: 44, minWidth: 44 })
    expect(icon.props).toMatchObject({
      color: darkTheme.color.text.inverse,
      size: 20,
      strokeWidth: 2
    })

    act(() => button.props.onPress())
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('keeps conditional header actions and localizes their fixed copy', async () => {
    const onOpenAgentSessionHistory = vi.fn()
    const onOpenChecks = vi.fn()
    await act(async () => {
      renderer = create(
        createElement(MobileSessionHeaderMoreActionsSheet, {
          visible: true,
          showAgentSessionHistory: true,
          showChecks: true,
          onOpenAgentSessionHistory,
          onOpenChecks,
          onClose: vi.fn()
        })
      )
    })
    const sheet = renderer!.root.findByType('ActionSheetModal')

    expect(sheet.props.actions.map((action: { label: string }) => action.label)).toEqual([
      'Agent 会话历史',
      '检查'
    ])
    expect(sheet.props.actions[0].hint).toBe('浏览并继续 Agent 会话')
    expect(sheet.props.actions[0].renderIcon().props.color).toBe(lightTheme.color.text.secondary)

    act(() => {
      sheet.props.actions[0].onPress()
      sheet.props.actions[1].onPress()
    })
    expect(onOpenAgentSessionHistory).toHaveBeenCalledOnce()
    expect(onOpenChecks).toHaveBeenCalledOnce()
  })

  it('preserves browser navigation targets, ordering, and close semantics', async () => {
    const target = {
      type: 'browser' as const,
      id: 'browser-1',
      title: '文档',
      browserWorkspaceId: 'workspace-1',
      browserPageId: 'page-1',
      url: 'https://example.com',
      loading: false,
      canGoBack: true,
      canGoForward: true,
      isActive: true
    }
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    const onCloseTab = vi.fn()
    const bulkCloseActions = vi.fn(() => [{ label: '关闭其他标签页', onPress: vi.fn() }])
    await act(async () => {
      renderer = create(
        createElement(MobileBrowserTabActionSheet, {
          target,
          onClose,
          onNavigate,
          onCloseTab,
          bulkCloseActions
        })
      )
    })
    const sheet = renderer!.root.findByType('ActionSheetModal')
    const actions = sheet.props.actions as { label: string; onPress: () => void }[]

    expect(actions.map((action) => action.label)).toEqual([
      '后退',
      '前进',
      '重新加载',
      '关闭',
      '关闭其他标签页'
    ])
    expect(bulkCloseActions).toHaveBeenCalledWith(target.id, onClose)

    act(() => {
      actions[0].onPress()
      actions[1].onPress()
      actions[2].onPress()
    })
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(onNavigate.mock.calls).toEqual([
      [target, 'browser.back'],
      [target, 'browser.forward'],
      [target, 'browser.reload']
    ])

    act(() => actions[3].onPress())
    expect(onClose).toHaveBeenCalledTimes(4)
    expect(onCloseTab).toHaveBeenCalledWith(target)
  })

  it('localizes the fixed title for a new blank browser tab', async () => {
    await act(async () => {
      renderer = create(
        createElement(MobileBrowserTabActionSheet, {
          target: {
            type: 'browser',
            id: 'browser-blank',
            title: '',
            browserWorkspaceId: 'workspace-1',
            browserPageId: null,
            url: 'about:blank',
            loading: false,
            canGoBack: false,
            canGoForward: false,
            isActive: true
          },
          onClose: vi.fn(),
          onNavigate: vi.fn(),
          onCloseTab: vi.fn()
        })
      )
    })

    expect(renderer!.root.findByType('ActionSheetModal').props.title).toBe('新建浏览器')
  })
})
