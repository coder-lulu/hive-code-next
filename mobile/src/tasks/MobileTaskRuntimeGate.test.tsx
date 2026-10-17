import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkTheme, lightTheme, type MobileTheme } from '../theme/mobile-theme'
import { MobileTaskRuntimeGate } from './MobileTaskRuntimeGate'
import type { MobileTaskRuntimeState } from './mobile-task-runtime-state'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { hairlineWidth: 1, create: <T,>(styles: T) => styles }
}))
vi.mock('lucide-react-native', () => ({ ListTodo: 'ListTodo', RefreshCw: 'RefreshCw' }))
let activeTheme: MobileTheme = lightTheme
vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => activeTheme,
  useMobileThemeStyles: (factory: (theme: MobileTheme) => unknown) => factory(activeTheme)
}))

describe.each([lightTheme, darkTheme])('task Runtime gate in $scheme', (theme) => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each<[MobileTaskRuntimeState, string]>([
    ['offline', 'Runtime 当前离线'],
    ['unavailable', 'Runtime 连接暂不可用'],
    ['disconnected', '尚未连接 Runtime'],
    ['auth-failed', 'Runtime 连接验证失败']
  ])('explains %s truthfully and keeps recovery actions available', (state, title) => {
    activeTheme = theme
    const onRetry = vi.fn()
    const onSelectRuntime = vi.fn()
    act(() => {
      renderer = create(createElement(MobileTaskRuntimeGate, { state, onRetry, onSelectRuntime }))
    })
    const texts = renderer!.root.findAll((node) => String(node.type) === 'Text')
    expect(texts.map((text) => text.props.children)).toContain(title)
    expect(texts.every((text) => text.props.maxFontSizeMultiplier === 1.3)).toBe(true)
    const buttons = renderer!.root.findAll((node) => String(node.type) === 'Pressable')
    act(() => buttons[0]!.props.onPress())
    act(() => buttons[1]!.props.onPress())
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onSelectRuntime).toHaveBeenCalledOnce()
  })

  it('shows loading without an offline assertion', () => {
    activeTheme = theme
    act(() => {
      renderer = create(
        createElement(MobileTaskRuntimeGate, { state: 'loading', onSelectRuntime: vi.fn() })
      )
    })
    expect(
      renderer!.root.findAll((node) => String(node.type) === 'ActivityIndicator')
    ).toHaveLength(1)
    expect(renderer!.root.findAll((node) => String(node.type) === 'Text')).toHaveLength(0)
  })
})
