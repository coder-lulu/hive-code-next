import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mobileThemes } from '../theme/mobile-theme'
import { AuthFailedBanner } from './AuthFailedBanner'
import { HostRouteNoticeBanner } from './HostRouteNoticeBanner'
import { ProtocolBlockScreen } from './ProtocolBlockScreen'
import { TextInputModal } from './TextInputModal'
import { WorkspaceDetailPlaceholder } from './WorkspaceDetailPlaceholder'

const themeState = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' }))
const routerMocks = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    absoluteFillObject: { position: 'absolute', inset: 0 },
    create: <T,>(styles: T) => styles
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Info: 'Info',
  ShieldAlert: 'ShieldAlert',
  SquareTerminal: 'SquareTerminal',
  TriangleAlert: 'TriangleAlert',
  X: 'X'
}))

vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))

vi.mock('expo-router', () => ({ router: routerMocks }))

vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => mobileThemes[themeState.scheme],
  useMobileThemeStyles: <T,>(
    factory: (theme: (typeof mobileThemes)[typeof themeState.scheme]) => T
  ) => factory(mobileThemes[themeState.scheme])
}))

vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

function resolvedStyle(node: ReactTestInstance, pressed = false): Record<string, unknown> {
  const style =
    typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const items = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...items.filter(Boolean))
}

describe('Graphite common states and overlays', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    themeState.scheme = 'light'
    routerMocks.replace.mockClear()
  })

  it('keeps authentication recovery ordered, accessible, and touch-safe', () => {
    const calls: string[] = []
    act(() => {
      renderer = create(
        createElement(AuthFailedBanner, {
          canRetry: true,
          onRetry: () => calls.push('retry'),
          onRepair: () => calls.push('repair'),
          onRemove: () => calls.push('remove')
        })
      )
    })

    expect(renderer!.root.findByType('TriangleAlert').props.color).toBe(
      mobileThemes.light.color.status.danger
    )
    const buttons = renderer!.root.findAllByType('Pressable')
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual([
      'Retry authentication',
      'Re-pair this computer',
      'Remove this computer'
    ])
    for (const button of buttons) {
      expect(resolvedStyle(button).minHeight).toBe(44)
      act(() => button.props.onPress())
    }
    expect(calls).toEqual(['retry', 'repair', 'remove'])
  })

  it('hides local removal when authentication failed for an account-only Runtime', () => {
    act(() => {
      renderer = create(
        createElement(AuthFailedBanner, {
          canRetry: true,
          onRetry: vi.fn(),
          onRepair: vi.fn()
        })
      )
    })

    expect(
      renderer!.root.findAllByType('Pressable').map((button) => button.props.accessibilityLabel)
    ).toEqual(['Retry authentication', 'Re-pair this computer'])
  })

  it('uses a semantic dark surface and a 44dp dismiss target for route notices', () => {
    themeState.scheme = 'dark'
    const onDismiss = vi.fn()
    act(() => {
      renderer = create(
        createElement(HostRouteNoticeBanner, { message: 'Workspace moved', onDismiss })
      )
    })

    const banner = renderer!.root.findAllByType('View')[0]!
    expect(resolvedStyle(banner)).toMatchObject({
      minHeight: 56,
      backgroundColor: mobileThemes.dark.color.bg.surface,
      borderBottomColor: mobileThemes.dark.color.border.subtle
    })
    const dismiss = renderer!.root.findByType('Pressable')
    expect(resolvedStyle(dismiss)).toMatchObject({ width: 44, height: 44 })
    act(() => dismiss.props.onPress())
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('renders the wide-layout placeholder from dynamic Graphite tokens', () => {
    themeState.scheme = 'dark'
    act(() => {
      renderer = create(createElement(WorkspaceDetailPlaceholder))
    })

    const container = renderer!.root.findAllByType('View')[0]!
    expect(resolvedStyle(container).backgroundColor).toBe(mobileThemes.dark.color.bg.canvas)
    expect(renderer!.root.findByType('SquareTerminal').props).toMatchObject({
      color: mobileThemes.dark.color.text.tertiary,
      size: 24,
      strokeWidth: 2
    })
    expect(
      renderer!.root.findAllByType('Text').every((node) => node.props.maxFontSizeMultiplier === 1.3)
    ).toBe(true)
  })

  it('trims modal input, exposes disabled state, and uses a semantic focus ring', () => {
    const onSubmit = vi.fn()
    act(() => {
      renderer = create(
        createElement(TextInputModal, {
          visible: true,
          title: 'Rename workspace',
          defaultValue: '',
          onSubmit,
          onCancel: vi.fn()
        })
      )
    })

    const submit = renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Save')!
    expect(submit.props.accessibilityState).toEqual({ disabled: true })
    expect(resolvedStyle(submit).minHeight).toBe(44)

    const input = renderer!.root.findByType('TextInput')
    act(() => input.props.onFocus())
    expect(resolvedStyle(renderer!.root.findByType('TextInput')).borderColor).toBe(
      mobileThemes.light.color.brand.primary
    )
    act(() => input.props.onChangeText('  graphite  '))
    const enabledSubmit = renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Save')!
    expect(enabledSubmit.props.accessibilityState).toEqual({ disabled: false })
    act(() => enabledSubmit.props.onPress())
    expect(onSubmit).toHaveBeenCalledWith('graphite')
  })

  it('keeps protocol recovery scrollable, safe-area aware, and monochrome', () => {
    themeState.scheme = 'dark'
    act(() => {
      renderer = create(
        createElement(ProtocolBlockScreen, {
          verdict: {
            kind: 'blocked',
            reason: 'desktop-too-old',
            desktopVersion: 0,
            requiredDesktopVersion: 1
          }
        })
      )
    })

    expect(renderer!.root.findByType('SafeAreaView').props.edges).toEqual(['top', 'bottom'])
    expect(renderer!.root.findByType('ScrollView').props.contentContainerStyle).toMatchObject({
      backgroundColor: mobileThemes.dark.color.bg.canvas,
      flexGrow: 1
    })
    const back = renderer!.root.findByType('Pressable')
    expect(back.props.accessibilityLabel).toBe('Back to hosts')
    expect(resolvedStyle(back).minHeight).toBe(44)
    act(() => back.props.onPress())
    expect(routerMocks.replace).toHaveBeenCalledWith('/')
  })
})
