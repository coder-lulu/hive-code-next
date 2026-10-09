vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: <T,>(factory: (theme: typeof lightTheme) => T) => factory(lightTheme)
  }
})

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatMessageActionsSheet } from './MobileNativeChatMessageActionsSheet'

const { writeText, alert } = vi.hoisted(() => ({ writeText: vi.fn(), alert: vi.fn() }))
const motion = vi.hoisted(() => ({ enabled: false }))
vi.mock('../hooks/use-reduced-motion-enabled', () => ({
  useReducedMotionEnabled: () => motion.enabled
}))
vi.mock('react-native', () => ({
  Alert: { alert },
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 })
}))
vi.mock('lucide-react-native', () => ({
  Copy: 'Copy',
  TextSelect: 'TextSelect',
  X: 'X',
  Edit3: 'Edit3',
  Trash2: 'Trash2'
}))
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText }) }))
// Keep the real drawer lifecycle; only native animation completion is driven by the test.
vi.mock('../components/mounted-bottom-drawer', () => ({ MountedBottomDrawer: 'MountedDrawer' }))

const message: NativeChatMessage = {
  id: 'reply',
  source: 'transcript',
  role: 'assistant',
  timestamp: null,
  blocks: [{ type: 'text', text: 'First words' }]
}

describe('message selection actions', () => {
  let renderer: ReactTestRenderer | null = null
  const onClose = vi.fn()
  const nodes = (type: string) => renderer!.root.findAll((node) => String(node.type) === type)
  const render = (value = message) => {
    act(() => {
      renderer = create(
        createElement(MobileNativeChatMessageActionsSheet, { message: value, onClose })
      )
    })
  }
  const pressAction = (index: number) => act(() => nodes('Pressable')[index]!.props.onPress())
  const finishClosing = () => act(() => nodes('MountedDrawer')[0]!.props.onHidden())

  beforeEach(() => {
    vi.clearAllMocks()
    motion.enabled = false
    writeText.mockResolvedValue(undefined)
  })
  afterEach(() => act(() => renderer?.unmount()))

  it('waits for drawer removal, then selects a stable snapshot while the reply streams', () => {
    render()
    act(() =>
      renderer!.update(
        createElement(MobileNativeChatMessageActionsSheet, {
          message: {
            ...message,
            blocks: [{ type: 'text', text: 'First words plus streamed text' }]
          },
          onClose
        })
      )
    )
    pressAction(1)
    expect(nodes('MountedDrawer')[0]!.props.visible).toBe(false)
    expect(nodes('Modal')).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
    finishClosing()
    expect(nodes('MountedDrawer')).toHaveLength(0)
    expect(nodes('Modal')).toHaveLength(1)
    const selected = nodes('Text').find((node) => node.props.selectable)
    expect(selected?.props.children).toBe('First words')
    act(() => nodes('Modal')[0]!.props.onRequestClose())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes selection with the accessible close button', () => {
    render()
    pressAction(1)
    finishClosing()
    const close = nodes('Pressable').find((node) => node.props.accessibilityLabel === '关闭')
    expect(close?.props.accessibilityRole).toBe('button')
    act(() => close!.props.onPress())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens selection without animation when reduced motion is enabled', () => {
    motion.enabled = true
    render()
    pressAction(1)
    finishClosing()
    expect(nodes('Modal')[0]!.props.animationType).toBe('none')
  })

  it('copies prose and dismisses only after the drawer closes', () => {
    render()
    pressAction(0)
    expect(writeText).toHaveBeenCalledWith('First words')
    expect(onClose).not.toHaveBeenCalled()
    finishClosing()
    expect(onClose).toHaveBeenCalledOnce()
    expect(nodes('Modal')).toHaveLength(0)
  })

  it('surfaces clipboard rejection', async () => {
    writeText.mockRejectedValue(new Error('Clipboard unavailable'))
    render()
    await act(async () => pressAction(0))
    expect(alert).toHaveBeenCalledWith('复制失败', 'Clipboard unavailable')
  })

  it('dismisses without selecting when the drawer is cancelled', () => {
    render()
    act(() => nodes('MountedDrawer')[0]!.props.onClose())
    finishClosing()
    expect(onClose).toHaveBeenCalledOnce()
    expect(nodes('Modal')).toHaveLength(0)
  })

  it('disables actions when the message has no copyable prose', () => {
    render({ ...message, blocks: [{ type: 'image-ref', path: '/image.png' }] })
    expect(nodes('Pressable').map((node) => node.props.disabled)).toEqual([true, true])
    expect(writeText).not.toHaveBeenCalled()
  })
})
