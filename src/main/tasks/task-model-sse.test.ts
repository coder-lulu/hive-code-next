import { describe, expect, it, vi } from 'vitest'
import { createTaskModelSseReader } from './task-model-sse'
import { TASK_MODEL_EVENT_BYTES, TASK_MODEL_RESPONSE_BYTES } from './task-model-channel-protocol'

const event = (type: string, rest: Record<string, unknown> = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`
const created = event('response.created', { response: { id: 'resp-fixture' } })
const completed = event('response.completed', { response: { id: 'resp-fixture' } })
const feed = (reader: ReturnType<typeof createTaskModelSseReader>, value: string) =>
  reader.feed(Buffer.from(value))

describe('bounded validated model SSE', () => {
  it('accepts fragmented UTF-8 and CRLF, normalizes only fully validated events', () => {
    const validate = vi.fn()
    const reader = createTaskModelSseReader(validate)
    const delta = event('response.output_text.delta', { delta: '中文🙂' })
    const bytes = Buffer.from((created + delta + completed).replaceAll('\n', '\r\n'))
    for (const byte of bytes) {
      reader.feed(Uint8Array.of(byte))
    }
    expect(reader.completed).toBe(true)
    expect(validate).toHaveBeenCalledTimes(3)
    expect(reader.take(TASK_MODEL_RESPONSE_BYTES).toString()).toBe(created + delta + completed)
    expect(reader.pendingBytes).toBe(0)
    expect(() => reader.finish()).not.toThrow()
  })

  it('does not emit partial or policy-refused events', () => {
    const reader = createTaskModelSseReader(() => {
      throw new Error('unapproved')
    })
    feed(reader, created.slice(0, -1))
    expect(reader.pendingBytes).toBe(0)
    expect(() => feed(reader, '\n')).toThrow('unapproved')
    expect(reader.take(100).length).toBe(0)
  })

  it('preserves byte order under small downstream pulls across thousands of events', () => {
    const reader = createTaskModelSseReader(() => undefined)
    const value =
      created +
      Array.from({ length: 2000 }, () =>
        event('response.output_text.delta', { delta: 'code🙂' })
      ).join('') +
      completed
    feed(reader, value)
    const chunks: Buffer[] = []
    while (reader.pendingBytes > 0) {
      chunks.push(reader.take(37))
    }
    expect(Buffer.concat(chunks).toString()).toBe(value)
    expect(reader.take(37).length).toBe(0)
  })

  it('permits comments and a completed-only DONE sentinel', () => {
    const reader = createTaskModelSseReader(() => undefined)
    feed(reader, `: ping\n\n${created}${completed}data: [DONE]\n\n`)
    expect(reader.take(10000).toString()).toBe(created + completed)
    reader.finish()
  })

  it('permits a DONE sentinel at every transport split after the completed response', () => {
    const trailer = 'data: [DONE]\r\n\r\n'
    for (let split = 1; split < trailer.length; split++) {
      const reader = createTaskModelSseReader(() => undefined)
      feed(reader, created + completed + trailer.slice(0, split))
      expect(() => reader.finish()).not.toThrow()
      feed(reader, trailer.slice(split))
      expect(reader.take(10000).toString()).toBe(created + completed)
      reader.finish()
    }
  })

  it.each([
    'data: [DONE]\n\n',
    completed,
    event('response.output_text.delta', { delta: 'before creation' }),
    created + created,
    created + event('response.completed', { response: { id: 'other' } }),
    `${
      created
    }event: other\ndata: {"type":"response.completed","response":{"id":"resp-fixture"}}\n\n`,
    created + completed + event('response.output_text.delta', { delta: 'late' }),
    `${created + completed}data: {`,
    'id: unbounded-replay\n\n',
    'retry: 1\n\n',
    'data: {"type":"UPPER"}\n\n',
    'data: []\n\n'
  ])('refuses invalid event/correlation/terminal input %#', (value) => {
    expect(() =>
      feed(
        createTaskModelSseReader(() => undefined),
        value
      )
    ).toThrow()
  })

  it.each([created, created + completed.slice(0, -1), `${created}data: {`])(
    'requires a complete terminal response and rejects unfinished tails %#',
    (value) => {
      const reader = createTaskModelSseReader(() => undefined)
      feed(reader, value)
      expect(() => reader.finish()).toThrow('TASK_MODEL_STREAM_REFUSED')
    }
  )

  it('bounds unfinished fragmented lines', () => {
    const reader = createTaskModelSseReader(() => undefined)
    for (let count = 0; count < TASK_MODEL_EVENT_BYTES; count += 4096) {
      reader.feed(Buffer.alloc(4096, 65))
    }
    expect(() => reader.feed(Buffer.from('A'))).toThrow('TASK_MODEL_STREAM_REFUSED')
    expect(reader.pendingBytes).toBe(0)
  })

  it('bounds complete lines and line count', () => {
    expect(() =>
      feed(
        createTaskModelSseReader(() => undefined),
        `:${'a'.repeat(TASK_MODEL_EVENT_BYTES)}\n`
      )
    ).toThrow('TASK_MODEL_STREAM_REFUSED')
    expect(() =>
      feed(
        createTaskModelSseReader(() => undefined),
        ':\n'.repeat(129)
      )
    ).toThrow('TASK_MODEL_STREAM_REFUSED')
  })

  it('rejects invalid UTF-8 and incomplete multibyte suffixes', () => {
    const reader = createTaskModelSseReader(() => undefined)
    expect(() => reader.feed(Uint8Array.of(255))).toThrow()
    const incomplete = createTaskModelSseReader(() => undefined)
    feed(incomplete, created + completed)
    incomplete.feed(Uint8Array.of(226))
    expect(() => incomplete.finish()).toThrow()
  })

  it('releases all retained output on reset', () => {
    const reader = createTaskModelSseReader(() => undefined)
    feed(reader, created + completed)
    reader.reset()
    expect(reader.pendingBytes).toBe(0)
    expect(reader.take(100).length).toBe(0)
  })
})
