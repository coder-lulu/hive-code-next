import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'
import { MobileNativeChatAsk } from './MobileNativeChatAsk'
import { MobileNativeChatQuestion } from './MobileNativeChatQuestion'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  CircleHelp: 'CircleHelp'
}))

vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: <T,>(factory: (theme: typeof lightTheme) => T) => factory(lightTheme)
  }
})

function pressableWithText(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const text = renderer.root
    .findAllByType('Text')
    .find((node) => String(node.props.children) === label)
  if (!text) {
    throw new Error(`No text labeled ${label}`)
  }
  let current = text.parent
  while (current && current.type !== 'Pressable') {
    current = current.parent
  }
  if (!current) {
    throw new Error(`No pressable for ${label}`)
  }
  return current
}

describe('native chat prompt cards', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps Ask option indices intact through the localized submit flow', async () => {
    const prompt: AskPrompt = {
      questions: [
        {
          question: 'Pick one',
          multiSelect: false,
          options: [{ label: 'Alpha' }, { label: 'Beta' }]
        }
      ]
    }
    const onAnswer = vi.fn().mockResolvedValue(true)
    await act(async () => {
      renderer = create(createElement(MobileNativeChatAsk, { prompt, onAnswer }))
    })

    act(() => pressableWithText(renderer!, 'Beta').props.onPress())
    await act(async () => pressableWithText(renderer!, '提交').props.onPress())

    expect(onAnswer).toHaveBeenCalledWith([{ indices: [1] }])
  })

  it('keeps Question token formatting intact through localized multi-select controls', async () => {
    const onAnswer = vi.fn().mockResolvedValue(true)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatQuestion, {
          question: {
            question: 'Pick several',
            options: ['Alpha', 'Beta'],
            multiSelect: true,
            optionTokens: ['1', '2']
          },
          onAnswer
        })
      )
    })

    act(() => {
      pressableWithText(renderer!, 'Alpha').props.onPress()
      pressableWithText(renderer!, 'Beta').props.onPress()
    })
    const submit = renderer!.root.find(
      (node) => node.type === 'Pressable' && node.props.accessibilityLabel === '提交已选选项'
    )
    await act(async () => submit.props.onPress())

    expect(onAnswer).toHaveBeenCalledWith('1, 2')
  })
})
