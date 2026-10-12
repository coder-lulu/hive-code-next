import { expect, it } from 'vitest'
import { decodeOmpTranscriptLine } from './transcript-line-decoders-omp'

it('shows the provider error instead of an empty reply', () => {
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
