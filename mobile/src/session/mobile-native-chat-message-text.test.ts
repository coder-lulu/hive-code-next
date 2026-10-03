import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { nativeChatMessageText } from './mobile-native-chat-message-text'

describe('nativeChatMessageText', () => {
  it('joins text blocks and skips non-text blocks', () => {
    const blocks: NativeChatBlock[] = [
      { type: 'text', text: 'Hello' },
      { type: 'tool-call', name: 'Read', input: {} },
      { type: 'text', text: 'World' }
    ]
    expect(nativeChatMessageText(blocks)).toBe('Hello\n\nWorld')
  })

  it('returns an empty string when there is no prose', () => {
    const blocks: NativeChatBlock[] = [{ type: 'tool-call', name: 'Read', input: {} }]
    expect(nativeChatMessageText(blocks)).toBe('')
  })

  it('trims surrounding whitespace', () => {
    expect(nativeChatMessageText([{ type: 'text', text: '  hi  ' }])).toBe('hi')
  })
})
