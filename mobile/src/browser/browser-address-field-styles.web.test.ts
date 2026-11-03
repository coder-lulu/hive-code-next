import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StyleSheet, Text, TextInput } from 'react-native'
import { MobileBrowserAddressField } from './MobileBrowserAddressField'
import { mobileBrowserPaneStyles } from './mobile-browser-pane-styles'
import { TextField } from '../components/composer-input/TextField'
import { COMPOSER_TEXT_SIZE } from '../components/composer-input/composer-input-styles'
import { applyMobileColorScheme, paletteForScheme } from '../theme/mobile-theme'
import { TEXT_INPUT_FONT_SIZE } from '../platform/text-input-font-size'

const platform = vi.hoisted(() => ({ OS: 'web' }))
vi.mock('react-native', () => ({
  Platform: platform,
  StyleSheet: {
    hairlineWidth: 1,
    absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    create: <T>(styles: T) => styles,
    flatten: (styles: unknown) => Object.assign({}, ...[styles].flat())
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('./MobileBrowserLoadProgress', () => ({ MobileBrowserLoadProgress: () => null }))
vi.mock(
  '../platform/text-input-font-size',
  async () => await import('../platform/text-input-font-size.web')
)

const renderers: ReactTestRenderer[] = []
function address(os: string, focused: boolean) {
  platform.OS = os
  let mounted: ReactTestRenderer | undefined
  act(() => {
    mounted = create(
      createElement(MobileBrowserAddressField, {
        disabled: false,
        focused,
        loading: false,
        loadFailed: false,
        value: 'file:///home/user/project/README.md',
        onBlur: vi.fn(),
        onChangeText: vi.fn(),
        onFocus: vi.fn(),
        onSubmit: vi.fn()
      })
    )
  })
  if (!mounted) {
    throw new Error('Address field did not mount')
  }
  renderers.push(mounted)
  return mounted
}
afterEach(() => {
  act(() => {
    for (const renderer of renderers.splice(0)) {
      renderer.unmount()
    }
  })
  applyMobileColorScheme('dark')
  platform.OS = 'web'
})

describe('actual browser address and keyboard input styles', () => {
  it.each(['web', 'ios', 'android'])(
    'keeps %s address text at the shared focus-safe size',
    (os) => {
      const mounted = address(os, true)
      const input = mounted.root.findByType(TextInput)
      const style = StyleSheet.flatten(input.props.style)
      expect(style.fontSize).toBe(COMPOSER_TEXT_SIZE)
      expect(style.fontSize).toBeGreaterThanOrEqual(16)
      expect(StyleSheet.flatten(mounted.root.findByType(TextField).props.style)).toMatchObject({
        height: 28,
        minHeight: 28
      })
    }
  )

  it('keeps the browser keyboard row above the web focus-zoom floor', () => {
    expect(mobileBrowserPaneStyles.keyboardInput.fontSize).toBe(TEXT_INPUT_FONT_SIZE)
    expect(mobileBrowserPaneStyles.keyboardInput.fontSize).toBeGreaterThanOrEqual(16)
  })

  it.each(['light', 'dark'] as const)(
    'keeps the %s file label aligned with the actual input',
    (scheme) => {
      applyMobileColorScheme(scheme)
      const mounted = address('web', false)
      const inputStyle = StyleSheet.flatten(mounted.root.findByType(TextInput).props.style)
      const labelStyle = StyleSheet.flatten(mounted.root.findByType(Text).props.style)
      expect(labelStyle.fontSize).toBe(inputStyle.fontSize)
      expect(labelStyle.color).toBe(paletteForScheme(scheme).textPrimary)
      expect(inputStyle.color).toBe(labelStyle.color)
      expect(labelStyle.flex).toBe(1)
      expect(mounted.root.findByType(Text).props.numberOfLines).toBe(1)
    }
  )

  it('keeps platform differences in keyboard hints, with identical input geometry', () => {
    const styles = ['web', 'ios', 'android'].map((os) =>
      StyleSheet.flatten(address(os, true).root.findByType(TextInput).props.style)
    )
    expect(styles[1]).toEqual(styles[0])
    expect(styles[2]).toEqual(styles[0])
  })
})
