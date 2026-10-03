import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mobileThemes } from '../theme/mobile-theme'
import { MobileSearchField } from './MobileSearchField'

const themeState = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' }))

vi.mock('react-native', () => ({
  InteractionManager: { runAfterInteractions: vi.fn() },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  TextInput: 'TextInput',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({ Search: 'Search', X: 'X' }))

vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => mobileThemes[themeState.scheme],
  useMobileThemeStyles: <T,>(
    factory: (theme: (typeof mobileThemes)[typeof themeState.scheme]) => T
  ) => factory(mobileThemes[themeState.scheme])
}))

function resolvedStyle(node: ReactTestInstance): Record<string, unknown> {
  const items = Array.isArray(node.props.style)
    ? node.props.style.flat(Infinity)
    : [node.props.style]
  return Object.assign({}, ...items.filter(Boolean))
}

describe('MobileSearchField', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    themeState.scheme = 'light'
  })

  it.each(['light', 'dark'] as const)('uses %s semantic surface colors', (scheme) => {
    themeState.scheme = scheme
    act(() => {
      renderer = create(
        createElement(MobileSearchField, {
          value: '',
          onChangeText: vi.fn(),
          placeholder: 'Search'
        })
      )
    })

    const shell = renderer!.root.findAllByType('View')[0]!
    expect(resolvedStyle(shell)).toMatchObject({
      minHeight: 44,
      backgroundColor: mobileThemes[scheme].color.bg.surface,
      borderColor: mobileThemes[scheme].color.border.default
    })
    expect(renderer!.root.findByType('TextInput').props).toMatchObject({
      placeholderTextColor: mobileThemes[scheme].color.text.tertiary,
      selectionColor: mobileThemes[scheme].color.brand.primary
    })
  })

  it('uses the brand focus ring', () => {
    act(() => {
      renderer = create(
        createElement(MobileSearchField, {
          value: '',
          onChangeText: vi.fn(),
          placeholder: 'Search'
        })
      )
    })

    act(() => renderer!.root.findByType('TextInput').props.onFocus())
    expect(resolvedStyle(renderer!.root.findAllByType('View')[0]!)).toMatchObject({
      borderColor: mobileThemes.light.color.brand.primary
    })
  })
})
