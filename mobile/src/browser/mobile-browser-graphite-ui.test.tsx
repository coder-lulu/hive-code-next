import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() }
}))
vi.mock('lucide-react-native', () => ({
  Delete: 'Delete',
  Monitor: 'Monitor',
  Smartphone: 'Smartphone'
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))

import { MobileThemeProvider } from '../theme/mobile-theme-provider'
import { MobileBrowserAddressField } from './MobileBrowserAddressField'
import { MobileBrowserKeyRow } from './MobileBrowserKeyRow'
import { MobileBrowserPointerModifiers } from './MobileBrowserPointerModifiers'
import { MobileBrowserToolbarIconButton } from './MobileBrowserToolbarIconButton'
import { MobileBrowserViewModeSwitch } from './MobileBrowserViewModeSwitch'

function resolvedStyle(node: ReactTestInstance): Record<string, unknown> {
  const raw = node.props.style
  const style = typeof raw === 'function' ? raw({ pressed: false }) : raw
  const items = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...items.filter(Boolean))
}

function renderControls(preference: 'light' | 'dark'): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(
        MobileThemeProvider,
        { preference },
        createElement(
          'View',
          null,
          createElement(
            MobileBrowserToolbarIconButton,
            {
              label: 'Back',
              onPress: () => {}
            },
            createElement('Icon')
          ),
          createElement(MobileBrowserAddressField, {
            disabled: false,
            focused: false,
            onBlur: () => {},
            onChangeText: () => {},
            onFocus: () => {},
            onSubmit: () => {},
            value: 'https://example.com'
          }),
          createElement(MobileBrowserViewModeSwitch, {
            disabled: false,
            onChange: () => {},
            value: 'web'
          }),
          createElement(MobileBrowserPointerModifiers, {
            disabled: false,
            onToggle: () => {},
            selectedModifiers: ['ctrl']
          }),
          createElement(MobileBrowserKeyRow, {
            disabled: false,
            onKeypress: () => {}
          })
        )
      )
    )
  })
  return renderer!
}

describe('mobile browser Graphite controls', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('uses the light semantic surface with accessible 44dp controls', () => {
    renderer = renderControls('light')

    const back = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Back')
    const address = renderer.root.findByType('TextInput')
    const enter = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Send Enter key to browser')
    const webMode = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Show web website view')

    expect(resolvedStyle(back!)).toMatchObject({ height: 44, width: 44 })
    expect(resolvedStyle(address)).toMatchObject({
      backgroundColor: '#FFFFFF',
      borderColor: '#DDE1E6',
      minHeight: 44
    })
    expect(address.props.accessibilityLabel).toBe('Browser address')
    expect(address.props.maxFontSizeMultiplier).toBe(1.3)
    expect(resolvedStyle(enter!).minHeight).toBe(44)
    expect(resolvedStyle(webMode!)).toMatchObject({ backgroundColor: '#17191D', minHeight: 44 })
  })

  it('uses the dark semantic palette and non-color selection semantics', () => {
    renderer = renderControls('dark')

    const address = renderer.root.findByType('TextInput')
    const ctrl = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Ctrl click modifier')

    expect(resolvedStyle(address)).toMatchObject({
      backgroundColor: '#171A1F',
      borderColor: '#30353D',
      color: '#F5F6F8'
    })
    expect(ctrl?.props.accessibilityState).toMatchObject({ selected: true })
    expect(resolvedStyle(ctrl!)).toMatchObject({ backgroundColor: '#F5F6F8' })
  })
})
