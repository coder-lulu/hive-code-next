vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: <T,>(factory: (theme: typeof lightTheme) => T) => factory(lightTheme)
  }
})

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { Keyboard } from 'react-native'
import { MobileNativeChatAsk } from './MobileNativeChatAsk'
import { MobileNativeChatPermission } from './MobileNativeChatPermission'

vi.mock('react-native', () => ({
  Keyboard: { dismiss: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios }
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronUp: 'ChevronUp',
  ShieldQuestion: 'ShieldQuestion',
  X: 'X'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'Markdown' }))

describe('rendered prompt card collapse controls', () => {
  it('collapses an Ask from its header chevron without cancelling or answering it', async () => {
    const onCollapse = vi.fn()
    const onCancel = vi.fn(async () => true)
    const onAnswer = vi.fn(async () => true)
    let tree: ReactTestRenderer | null = null
    await act(async () => {
      tree = create(
        createElement(MobileNativeChatAsk, {
          prompt: {
            questions: [{ question: 'Pick?', options: [{ label: 'East' }], multiSelect: false }]
          },
          onAnswer,
          onCancel,
          onCollapse
        })
      )
    })
    act(() => tree!.root.findByProps({ accessibilityLabel: '收起请求' }).props.onPress())
    expect(onCollapse).toHaveBeenCalledOnce()
    // The reply field the collapse hides must not keep the keyboard.
    expect(Keyboard.dismiss).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onAnswer).not.toHaveBeenCalled()
    act(() => tree!.unmount())
  })

  it('shows Collapse in a terminal permission header and keeps Cancel where the lane can cancel', async () => {
    const permission = {
      title: 'Allow Bash?',
      options: [
        { label: 'Allow', send: '1' },
        { label: 'Deny', send: '\x1b' }
      ]
    }
    const onCollapse = vi.fn()
    const onCancel = vi.fn(async () => true)
    let tree: ReactTestRenderer | null = null
    await act(async () => {
      tree = create(
        createElement(MobileNativeChatPermission, {
          permission,
          onRespond: async () => true,
          onCollapse
        })
      )
    })
    expect(tree!.root.findAllByProps({ accessibilityLabel: '取消请求' })).toHaveLength(0)
    act(() => tree!.root.findByProps({ accessibilityLabel: '收起请求' }).props.onPress())
    expect(onCollapse).toHaveBeenCalledOnce()
    await act(async () => {
      tree!.update(
        createElement(MobileNativeChatPermission, {
          permission,
          onRespond: async () => true,
          onCancel,
          onCollapse
        })
      )
    })
    expect(tree!.root.findAllByProps({ accessibilityLabel: '收起请求' })).toHaveLength(0)
    act(() => tree!.root.findByProps({ accessibilityLabel: '取消请求' }).props.onPress())
    expect(onCancel).toHaveBeenCalledOnce()
    act(() => tree!.unmount())
  })
})
