import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileHostCard } from './MobileHostCard'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { lightTheme } from '../theme/mobile-theme'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Monitor: 'Monitor',
  MoreVertical: 'MoreVertical'
}))

vi.mock('./StatusDot', () => ({
  StatusDot: 'StatusDot'
}))

function suppressRendererDeprecation() {
  return vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
      throw new Error(String(args[0]))
    }
  })
}

describe('MobileHostCard', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('keeps host navigation and actions as separate accessible controls', async () => {
    const onPress = vi.fn()
    const onLongPress = vi.fn()
    const onOpenActions = vi.fn()
    const consoleError = suppressRendererDeprecation()
    await act(async () => {
      renderer = create(
        createElement(MobileHostCard, {
          theme: lightTheme,
          host: {
            id: 'desk',
            name: 'Desk',
            endpoint: 'ws://192.168.1.2:6768',
            deviceToken: 'token',
            publicKeyB64: 'key',
            lastConnected: 1
          },
          state: 'disconnected',
          verdict: { kind: 'normal', label: 'Disconnected' },
          path: 'lan',
          onPress,
          onLongPress,
          onOpenActions
        })
      )
    })
    consoleError.mockRestore()

    const buttons = renderer.root.findAllByType('Pressable')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].props.accessibilityRole).toBe('button')
    expect(buttons[0].props.accessibilityLabel).toBe('打开 Desk, 未连接')
    expect(buttons[1].props.accessibilityRole).toBe('button')
    expect(buttons[1].props.accessibilityLabel).toBe('Desk 的更多操作')
    expect(buttons[1].props.hitSlop).toBe(8)
    expect(buttons[1].props.style({ pressed: false })[0]).toMatchObject({ width: 44, height: 44 })
    expect(renderer.root.findAllByType('MoreVertical')).toHaveLength(1)
    expect(renderer.root.findAllByType('ChevronRight')).toHaveLength(0)

    act(() => buttons[1].props.onPress())
    expect(onOpenActions).toHaveBeenCalledOnce()
    expect(onPress).not.toHaveBeenCalled()

    act(() => buttons[0].props.onPress())
    act(() => buttons[0].props.onLongPress())
    expect(onPress).toHaveBeenCalledOnce()
    expect(onLongPress).toHaveBeenCalledOnce()
  })

  it('announces the connection path without the visual separator', async () => {
    const consoleError = suppressRendererDeprecation()
    await act(async () => {
      renderer = create(
        createElement(MobileHostCard, {
          theme: lightTheme,
          host: {
            id: 'desk',
            name: 'Desk',
            endpoint: 'ws://192.168.1.2:6768',
            deviceToken: 'token',
            publicKeyB64: 'key',
            lastConnected: 1
          },
          state: 'connected',
          verdict: { kind: 'normal', label: 'Connected' },
          path: 'tailscale',
          worktreeInfo: {
            hostId: 'desk',
            totalWorktrees: 3,
            activeCount: 2,
            lastActiveWorktree: null,
            countsProvenAt: Date.now()
          },
          onPress: vi.fn(),
          onLongPress: vi.fn(),
          onOpenActions: vi.fn()
        })
      )
    })
    consoleError.mockRestore()

    const navigationButton = renderer.root.findAllByType('Pressable')[0]
    expect(navigationButton.props.accessibilityLabel).toBe(
      '打开 Desk, 已连接, 直连，Tailscale, 3 个工作区，2 个活跃'
    )
  })

  it('preserves the connected worktree-catalog failure state', async () => {
    const consoleError = suppressRendererDeprecation()
    await act(async () => {
      renderer = create(
        createElement(MobileHostCard, {
          theme: lightTheme,
          host: {
            id: 'desk',
            name: 'Desk',
            endpoint: 'ws://192.168.1.2:6768',
            deviceToken: 'token',
            publicKeyB64: 'key',
            lastConnected: 1
          },
          state: 'connected',
          verdict: { kind: 'normal', label: 'Connected' },
          path: 'relay',
          worktreeInfo: {
            hostId: 'desk',
            totalWorktrees: 0,
            activeCount: 0,
            lastActiveWorktree: null,
            catalogUnavailable: true
          },
          onPress: vi.fn(),
          onLongPress: vi.fn(),
          onOpenActions: vi.fn()
        })
      )
    })
    consoleError.mockRestore()

    const navigationButton = renderer.root.findAllByType('Pressable')[0]
    expect(navigationButton.props.accessibilityLabel).toBe(
      `打开 Desk, 已连接, ${APP_DISPLAY_NAME} 安全中继, 工作区列表不可用`
    )
    expect(
      renderer.root.findAllByType('Text').some((node) => node.children.includes('工作区列表不可用'))
    ).toBe(true)
  })

  it('includes visible offline recovery guidance in the navigation label', async () => {
    const consoleError = suppressRendererDeprecation()
    await act(async () => {
      renderer = create(
        createElement(MobileHostCard, {
          theme: lightTheme,
          host: {
            id: 'desk',
            name: 'Desk',
            endpoint: 'ws://192.168.1.2:6768',
            deviceToken: 'token',
            publicKeyB64: 'key',
            lastConnected: 1
          },
          state: 'reconnecting',
          verdict: {
            kind: 'unreachable',
            label: "Can't reach desktop",
            reason: 'never-connected'
          },
          path: 'lan',
          onPress: vi.fn(),
          onLongPress: vi.fn(),
          onOpenActions: vi.fn()
        })
      )
    })
    consoleError.mockRestore()

    const navigationButton = renderer.root.findAllByType('Pressable')[0]
    expect(navigationButton.props.accessibilityLabel).toBe(
      `打开 Desk, 无法访问桌面端, 更新桌面端 ${APP_DISPLAY_NAME} 并登录，以便随时随地连接`
    )
  })
})
