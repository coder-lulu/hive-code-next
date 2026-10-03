import { expect, it } from 'vitest'
import { resolveNativeChatTranscriptAgent } from '../../shared/native-chat-agent-support'
import { decodeOmpTranscriptLine } from './transcript-line-decoders-omp'

it('renders actual Pi session entries using the existing compatible decoder', async () => {
  const { SessionManager } =
    await import('../../../runtime/native-pi/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js')
  const manager = SessionManager.inMemory('/workspace')
  manager.appendMessage({ role: 'user', content: 'read file', timestamp: 1 })
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'README.md' } }],
    api: 'openai-completions',
    provider: 'hive',
    model: 'test',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'toolUse',
    timestamp: 2
  })
  manager.appendMessage({
    role: 'toolResult',
    toolCallId: 'read-1',
    toolName: 'read',
    content: [{ type: 'text', text: 'file contents' }],
    isError: false,
    timestamp: 3
  })
  expect(resolveNativeChatTranscriptAgent('hivecode')).toBe('omp')
  const decoded = manager
    .getEntries()
    .map((entry) => decodeOmpTranscriptLine(JSON.stringify(entry), 'fallback'))
  expect(decoded.map((message) => message?.role)).toEqual(['user', 'assistant', 'tool'])
  expect(decoded[1]?.blocks[0]?.type).toBe('tool-call')
  expect(decoded[2]?.blocks[0]).toMatchObject({ type: 'tool-result', output: 'file contents' })
})

it('shows the native Pi provider error instead of an empty reply', () => {
  expect(
    decodeOmpTranscriptLine(
      JSON.stringify({
        type: 'message',
        id: 'failure',
        message: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: 'Gateway rejected the request (403)'
        }
      }),
      'fallback'
    )
  ).toMatchObject({
    role: 'system',
    blocks: [{ type: 'text', text: 'Gateway rejected the request (403)' }]
  })
})

it.each(['text', 'thinking'])('retains the error after partial %s output', (type) => {
  const content =
    type === 'text' ? { type, text: 'Partial answer' } : { type, thinking: 'Partial reasoning' }
  const decoded = decodeOmpTranscriptLine(
    JSON.stringify({
      type: 'message',
      id: 'partial-failure',
      message: {
        role: 'assistant',
        content: [content],
        stopReason: 'error',
        errorMessage: 'Stream disconnected before completion'
      }
    }),
    'fallback'
  )
  expect(decoded?.role).toBe('assistant')
  expect(decoded?.blocks).toEqual([
    { type: 'text', text: type === 'text' ? 'Partial answer' : 'Partial reasoning' },
    { type: 'text', text: 'Stream disconnected before completion' }
  ])
})
