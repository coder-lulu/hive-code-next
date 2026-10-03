import { z } from 'zod'
import {
  hiveAiTextExecutionSchema,
  hiveAiTextControlRequestSchema
} from '../../shared/hive-ai-text-control'
import { parseHiveRelayJson } from '../../shared/hive-relay-json'

const common = {
  requestId: hiveAiTextControlRequestSchema.unwrap().shape.requestId,
  sequence: z.number().int().min(1).max(1000)
}
const textFrame = z
  .strictObject({
    ...common,
    type: z.literal('text'),
    text: z.string().min(1).max(131072)
  })
  .readonly()
const resultFrame = z
  .strictObject({
    ...common,
    type: z.literal('result'),
    replay: z.boolean(),
    state: z.enum([
      'INTENT_RECORDED',
      'DISPATCHED',
      'COMPLETED',
      'FAILED',
      'UNKNOWN',
      'RECONCILED'
    ]),
    execution: hiveAiTextExecutionSchema.nullable()
  })
  .readonly()
const frame = z.discriminatedUnion('type', [textFrame, resultFrame])
export type HiveAiTextStreamResult = z.infer<typeof resultFrame>
const fail = () => new Error('hive_ai_stream_unavailable')

/** A result is execution evidence, not settlement or replayed answer content. */
export async function readHiveAiTextStream(input: {
  body: ReadableStream<Uint8Array>
  requestId: string
  signal: AbortSignal
  assertCurrent: () => void
  onText: (text: string) => void | Promise<void>
}): Promise<HiveAiTextStreamResult> {
  const reader = input.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = '',
    bytes = 0,
    sequence = 0
  let result: HiveAiTextStreamResult | undefined
  const guard = () => {
    input.assertCurrent()
    if (input.signal.aborted) {
      throw fail()
    }
  }
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  input.signal.addEventListener('abort', cancel, { once: true })
  try {
    guard()
    while (true) {
      const chunk = await reader.read()
      guard()
      if (chunk.done) {
        pending += decoder.decode()
        if (pending !== '' || !result) {
          throw fail()
        }
        return result
      }
      bytes += chunk.value.byteLength
      if (bytes > 2_097_152) {
        throw fail()
      }
      pending += decoder.decode(chunk.value, { stream: true })
      let boundary: number
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const line = pending.slice(0, boundary)
        pending = pending.slice(boundary + 2)
        if (line.length > 524288 || !line.startsWith('data:') || line.includes('\n') || result) {
          throw fail()
        }
        const event = frame.parse(parseHiveRelayJson(line.slice(5), 524288))
        if (event.requestId !== input.requestId || event.sequence !== ++sequence) {
          throw fail()
        }
        guard()
        if (event.type === 'text') {
          if (sequence > 999 || !event.text.isWellFormed()) {
            throw fail()
          }
          await input.onText(event.text)
          guard()
        } else {
          if (event.replay && sequence !== 1) {
            throw fail()
          }
          result = event
        }
      }
      if (pending.length > 524288) {
        throw fail()
      }
    }
  } catch {
    throw fail()
  } finally {
    input.signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}
