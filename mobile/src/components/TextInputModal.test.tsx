import { findAllByHostType, findByHostType } from '../test-support/react-test-renderer-host-nodes'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyMobileColorScheme, paletteForScheme } from '../theme/mobile-theme'
import { TextInputModal } from './TextInputModal'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles }
}))
vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

describe('TextInputModal asynchronous submission', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    applyMobileColorScheme('light')
  })
  it.each([false, true])(
    'keeps failures readable and prevents submission while pending (dark=%s)',
    async (dark) => {
      applyMobileColorScheme(dark ? 'dark' : 'light')
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
      const submit = () => findAllByHostType(renderer!.root, 'Pressable')[1]
      expect(submit().props.disabled).toBe(true)
      expect(submit().props.accessibilityState.busy).toBe(true)
      act(() => findByHostType(renderer!.root, 'TextInput').props.onSubmitEditing())
      expect(onSubmit).not.toHaveBeenCalled()
      await act(async () => {
        renderer!.update(
          createElement(TextInputModal, { ...props, errorMessage: 'Workspace unavailable' })
        )
      })
      const alert = renderer!.root.findByProps({ accessibilityRole: 'alert' })
      expect(alert.props.children).toBe('Workspace unavailable')
      expect(alert.props.style.color).toBe(paletteForScheme(dark ? 'dark' : 'light').statusRed)
      expect(submit().props.disabled).toBe(false)
      act(() => submit().props.onPress())
      expect(onSubmit).toHaveBeenCalledWith('')
    }
  )
})
