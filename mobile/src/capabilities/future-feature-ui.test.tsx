import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({
  back: vi.fn(),
  canGoBack: vi.fn(() => false),
  replace: vi.fn()
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() }
}))
vi.mock('expo-router', () => ({
  Stack: { Screen: 'Stack.Screen' },
  useRouter: () => navigation
}))
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }))
vi.mock('lucide-react-native', () => ({
  CheckCircle2: 'CheckCircle2',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Circle: 'Circle',
  Square: 'Square',
  SquareCheckBig: 'SquareCheckBig'
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 12, left: 0, right: 0, top: 0 })
}))

import { MobileThemeProvider } from '../theme/mobile-theme-provider'
import {
  FutureFeatureAction,
  FutureFeatureInput,
  FutureFeatureNotice
} from './FutureFeatureControls'
import { FutureFeatureScreen } from './FutureFeatureUI'

function renderWithTheme(
  children: ReactNode,
  preference: 'light' | 'dark' = 'light'
): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(createElement(MobileThemeProvider, { preference }, children))
  })
  return renderer!
}

function resolvedStyle(node: ReactTestInstance, prop = 'style'): Record<string, unknown> {
  const raw = node.props[prop]
  const style = typeof raw === 'function' ? raw({ pressed: false }) : raw
  const items = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...items.filter(Boolean))
}

function renderedText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : renderedText(child)))
    .join('')
}

describe('future feature Graphite shell', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.clearAllMocks()
  })

  it('uses safe keyboard layout, token spacing, readable preview state, and back fallback', () => {
    renderer = renderWithTheme(
      createElement(
        FutureFeatureScreen,
        {
          capabilityId: 'account',
          description: '账号能力说明',
          title: '产品账号'
        },
        createElement('Child')
      )
    )

    expect(renderer.root.findByType('KeyboardAvoidingView').props.behavior).toBe('padding')
    expect(
      resolvedStyle(renderer.root.findByType('ScrollView'), 'contentContainerStyle')
    ).toMatchObject({
      gap: 24,
      paddingBottom: 44,
      paddingHorizontal: 20,
      paddingTop: 20
    })
    expect(renderedText(renderer.root)).toContain('界面预览')
    expect(renderedText(renderer.root)).toContain('服务能力正在建设')

    const back = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === '返回')
    expect(back).toBeDefined()
    expect(resolvedStyle(back!)).toMatchObject({ height: 44, width: 44 })
    act(() => back!.props.onPress())
    expect(navigation.replace).toHaveBeenCalledWith('/settings')
  })

  it('provides 130% text scaling, focus, disabled, and danger semantics', () => {
    renderer = renderWithTheme(
      createElement(
        'View',
        null,
        createElement(FutureFeatureInput, {
          label: '手机号',
          onChangeText: () => {},
          value: ''
        }),
        createElement(FutureFeatureAction, {
          disabled: true,
          label: '登录',
          reason: '服务尚未接入'
        }),
        createElement(FutureFeatureNotice, { danger: true, title: '无法继续' }, '请稍后重试')
      )
    )

    let input = renderer.root.findByType('TextInput')
    expect(input.props.maxFontSizeMultiplier).toBe(1.3)
    expect(resolvedStyle(input)).toMatchObject({ borderColor: '#DDE1E6', minHeight: 48 })
    act(() => input.props.onFocus())
    input = renderer.root.findByType('TextInput')
    expect(resolvedStyle(input).borderColor).toBe('#2F6BFF')

    const action = renderer.root.findByType('Pressable')
    expect(action.props.accessibilityState).toEqual({ busy: false, disabled: true })
    expect(resolvedStyle(action).minHeight).toBe(48)
    const alert = renderer.root
      .findAllByType('View')
      .find((node) => node.props.accessibilityRole === 'alert')
    expect(alert?.props.accessibilityLiveRegion).toBe('assertive')
  })

  it('uses the semantic dark palette immediately', () => {
    renderer = renderWithTheme(
      createElement(
        FutureFeatureScreen,
        {
          capabilityId: 'storage',
          description: '存储能力说明',
          title: '存储空间'
        },
        createElement('Child')
      ),
      'dark'
    )

    const screen = renderer.root.findAllByType('View')[0]
    expect(resolvedStyle(screen).backgroundColor).toBe('#0D0F12')
    expect(renderer.root.findByType('StatusBar').props.style).toBe('light')
  })
})
