import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LucideIcon } from 'lucide-react-native'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))

import { MobileThemeProvider } from '../../theme/mobile-theme-provider'
import { MobileGroupedList, MobileGroupedListRow } from './MobileGroupedList'
import { MobileIconButton } from './MobileIconButton'
import { MobileScreenHeader } from './MobileScreenHeader'
import { MobileSegmentedControl } from './MobileSegmentedControl'

const TestIcon = ((props: Record<string, unknown>) =>
  createElement('TestIcon', props)) as unknown as LucideIcon

function renderWithTheme(children: ReactNode): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(MobileThemeProvider, { systemSchemeOverride: 'light' }, children)
    )
  })
  return renderer!
}

function resolvedStyle(node: ReactTestInstance, pressed = false): Record<string, unknown> {
  const style =
    typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const items = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...items.filter(Boolean))
}

describe('Graphite Precision mobile UI primitives', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps icon buttons accessible and at least 44dp', () => {
    renderer = renderWithTheme(
      createElement(MobileIconButton, {
        accessibilityLabel: 'Open menu',
        icon: TestIcon,
        onPress: () => {}
      })
    )
    const button = renderer.root.findByType('Pressable')
    expect(button.props.accessibilityLabel).toBe('Open menu')
    expect(button.props.accessibilityState).toEqual({ disabled: false, selected: false })
    expect(resolvedStyle(button)).toMatchObject({ width: 44, height: 44, borderRadius: 8 })
    expect(renderer.root.findByType('TestIcon').props).toMatchObject({ size: 20, strokeWidth: 2 })
  })

  it('exposes a disabled loading state for icon buttons', () => {
    renderer = renderWithTheme(
      createElement(MobileIconButton, {
        accessibilityLabel: 'Saving',
        icon: TestIcon,
        loading: true,
        onPress: () => {}
      })
    )
    const button = renderer.root.findByType('Pressable')
    expect(button.props.disabled).toBe(true)
    expect(button.props.accessibilityState.disabled).toBe(true)
    expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(1)
  })

  it('uses graphite inversion and 44dp options for the two-state segmented control', () => {
    const onValueChange = vi.fn()
    renderer = renderWithTheme(
      createElement(MobileSegmentedControl, {
        accessibilityLabel: 'Work mode',
        onValueChange,
        options: [
          { label: '云端工作', value: 'cloud' },
          { label: '连接电脑', value: 'computer' }
        ],
        value: 'cloud'
      })
    )
    const options = renderer.root.findAllByType('Pressable')
    expect(resolvedStyle(options[0])).toMatchObject({
      minWidth: 44,
      minHeight: 44,
      borderRadius: 4,
      backgroundColor: '#17191D'
    })
    expect(options[0].props.accessibilityState.selected).toBe(true)
    act(() => options[1].props.onPress())
    expect(onValueChange).toHaveBeenCalledWith('computer')
  })

  it('renders a 56dp safe-area header with balanced 44dp action slots', () => {
    renderer = renderWithTheme(
      createElement(MobileScreenHeader, {
        leading: createElement('Leading'),
        title: '设置',
        trailing: createElement('Trailing')
      })
    )
    expect(renderer.root.findByType('SafeAreaView').props.edges).toEqual(['top'])
    const views = renderer.root.findAllByType('View')
    expect(views.some((node) => resolvedStyle(node).height === 56)).toBe(true)
    expect(views.filter((node) => resolvedStyle(node).width === 44)).toHaveLength(2)
    expect(renderer.root.findByType('Text').props.maxFontSizeMultiplier).toBe(1.3)
  })

  it('groups rows in one card with dividers and accessible press behavior', () => {
    const onPress = vi.fn()
    renderer = renderWithTheme(
      createElement(
        MobileGroupedList,
        { title: '客户端' },
        createElement(MobileGroupedListRow, { title: '通知', onPress }),
        createElement(MobileGroupedListRow, { title: '关于', value: '1.0.0' })
      )
    )
    const button = renderer.root.findByType('Pressable')
    expect(button.props.accessibilityLabel).toBe('通知')
    expect(resolvedStyle(button).minHeight).toBe(56)
    act(() => button.props.onPress())
    expect(onPress).toHaveBeenCalledOnce()
    const views = renderer.root.findAllByType('View')
    expect(views.some((node) => resolvedStyle(node).borderRadius === 12)).toBe(true)
    expect(views.filter((node) => resolvedStyle(node).height === 1)).toHaveLength(1)
  })
})
