import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme, darkTheme } from '../theme/mobile-theme'
import { TextInputModal } from './TextInputModal'

const state = vi.hoisted(() => ({ dark: false }))
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles }
}))
vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => (state.dark ? darkTheme : lightTheme),
  useMobileThemeStyles: <T,>(factory: (theme: typeof lightTheme) => T) =>
    factory(state.dark ? darkTheme : lightTheme)
}))
vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

describe('TextInputModal asynchronous submission', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  it.each([false, true])(
    'keeps failures readable and prevents submission while pending (dark=%s)',
    async (dark) => {
      state.dark = dark
      const onSubmit = vi.fn()
      const props = {
        visible: true,
        title: 'Browser',
        allowEmpty: true,
        onSubmit,
        onCancel: vi.fn()
      }
      await act(async () => {
        renderer = create(createElement(TextInputModal, { ...props, submitting: true }))
      })
      const submit = () => renderer!.root.findAllByType('Pressable')[1]
      expect(submit().props.disabled).toBe(true)
      expect(submit().props.accessibilityState.busy).toBe(true)
      act(() => renderer!.root.findByType('TextInput').props.onSubmitEditing())
      expect(onSubmit).not.toHaveBeenCalled()
      await act(async () => {
        renderer!.update(
          createElement(TextInputModal, { ...props, errorMessage: 'Workspace unavailable' })
        )
      })
      const alert = renderer!.root.findByProps({ accessibilityRole: 'alert' })
      expect(alert.props.children).toBe('Workspace unavailable')
      expect(alert.props.style.color).toBe((dark ? darkTheme : lightTheme).color.status.danger)
      expect(submit().props.disabled).toBe(false)
      act(() => submit().props.onPress())
      expect(onSubmit).toHaveBeenCalledWith('')
    }
  )
})
