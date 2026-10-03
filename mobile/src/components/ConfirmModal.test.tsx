import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { ConfirmModal } from './ConfirmModal'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => lightTheme,
  useMobileThemeStyles: <T,>(factory: (theme: typeof lightTheme) => T) => factory(lightTheme)
}))

vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

describe('ConfirmModal', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('confirms before closing and keeps cancellation side-effect free', async () => {
    const calls: string[] = []
    await act(async () => {
      renderer = create(
        createElement(ConfirmModal, {
          visible: true,
          title: '确认操作',
          message: '说明',
          confirmLabel: '继续',
          cancelLabel: '取消',
          onConfirm: () => calls.push('confirm'),
          onCancel: () => calls.push('cancel')
        })
      )
    })

    const buttons = renderer.root.findAllByType('Pressable')
    act(() => buttons[1]?.props.onPress())
    expect(calls).toEqual(['confirm', 'cancel'])

    calls.length = 0
    act(() => buttons[0]?.props.onPress())
    expect(calls).toEqual(['cancel'])
  })
})
