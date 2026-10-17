import { createElement } from 'react'
import { vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'

const scrollToEnd = vi.hoisted(() => vi.fn())
const scrollToOffset = vi.hoisted(() => vi.fn())
const scrollToIndex = vi.hoisted(() => vi.fn())
const platform = vi.hoisted(() => ({ OS: 'ios' }))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({ scrollToEnd, scrollToOffset, scrollToIndex }), [])
      return React.createElement('FlatList', props)
    }),
    Platform: platform,
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View'
  }
})

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))

vi.mock('react-native-gesture-handler', () => {
  const chain = {
    runOnJS: () => chain,
    onStart: () => chain,
    onUpdate: () => chain
  }
  return {
    Gesture: { Simultaneous: () => ({}), Native: () => ({}), Pinch: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Square: 'Square'
}))

vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: <T>(factory: (theme: typeof lightTheme) => T) => factory(lightTheme)
  }
})

vi.mock('./MobileNativeChatTurnStatus', () => ({ MobileNativeChatTurnActivity: 'TurnActivity' }))
vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('./MobileNativeChatLiveLine', () => ({ MobileNativeChatLiveLine: 'LiveStatus' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: 'ActionSheetModal' }))
vi.mock('./MobileAgentWorkingIndicator', () => ({
  MobileAgentWorkingIndicator: 'WorkingIndicator'
}))

// Stand-in composer: exposes the view's `handleSend` through a pressable, which is
// the only composer behaviour these banner tests exercise.
vi.mock('./MobileNativeChatComposer', async () => {
  const React = await import('react')
  return {
    MobileNativeChatComposer: (props: {
      onSend: (text: string) => Promise<boolean>
      disabled?: boolean
      placeholder?: string
    }) =>
      React.createElement('Composer', {
        ...props,
        accessibilityLabel: 'Send message',
        onPress: () => props.onSend('hi')
      })
  }
})

export type Overrides = Partial<Parameters<typeof MobileNativeChatView>[0]>

export function assistantTurn(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'hook' }
}

export function chatViewElement(overrides: Overrides): ReturnType<typeof createElement> {
  return createElement(MobileNativeChatView, {
    messages: [],
    folded: [],
    status: 'ready',
    streaming: null,
    onSend: vi.fn().mockResolvedValue(true),
    sendSurfaceId: 'tab-a',
    getSendCompletionGeneration: () => 0,
    getComposerEditGeneration: () => 0,
    pending: [],
    composerText: '',
    onComposerTextChange: vi.fn(),
    ...overrides
  })
}

export { scrollToEnd, scrollToOffset, scrollToIndex, platform }
