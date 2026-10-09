import { MobileThemeProvider } from '../theme/mobile-theme-provider'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => false,
    addEventListener: () => ({ remove: () => {} })
  },
  useColorScheme: () => 'light',
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
  CircleHelp: 'CircleHelp',
  ShieldQuestion: 'ShieldQuestion',
  X: 'X'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'Markdown' }))

const textInput = (root: ReactTestInstance) =>
  root.find((node) => node.props.placeholder === '输入你的回答')
const ask = { questions: [{ question: 'Pick?', options: [{ label: 'East' }], multiSelect: false }] }

describe('MobileNativeChatPromptCard collapse', () => {
  it('keeps a partly answered Ask mounted but hidden while collapsed', async () => {
    let tree: ReactTestRenderer | null = null
    const render = (collapsed: boolean) =>
      createElement(MobileNativeChatPromptCard, {
        ask,
        collapsedPrompt: collapsed ? { title: 'Pick?', expand: () => {} } : null
      })
    await act(async () => {
      tree = create(createElement(MobileThemeProvider, { preference: 'light' }, render(false)))
    })
    const other = tree!.root.findAll((node) => node.props.label === '其他…')[0]!
    act(() => other.props.onPress())
    act(() => textInput(tree!.root).props.onChangeText('turbo'))

    await act(async () =>
      tree!.update(createElement(MobileThemeProvider, { preference: 'light' }, render(true)))
    )
    expect(tree!.root.findByProps({ testID: 'native-chat-prompt-strip' })).toBeTruthy()
    const hidden = tree!.root.findAll((node) => node.props.style?.display === 'none')
    expect(hidden).toHaveLength(1)
    expect(textInput(hidden[0]!).props.value).toBe('turbo')

    await act(async () =>
      tree!.update(createElement(MobileThemeProvider, { preference: 'light' }, render(false)))
    )
    expect(textInput(tree!.root).props.value).toBe('turbo')
    act(() => tree!.unmount())
  })
})
