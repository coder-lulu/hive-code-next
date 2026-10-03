import { z } from 'zod'
import { hiveAiModelSelectionCommandSchema } from './hive-ai-model-catalog'
import { hiveAgentGenerationIdSchema, hiveAgentSessionIdSchema } from './hive-agent-session-schema'

const encoder = new TextEncoder()
const malformedUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const text = z
  .string()
  .min(1)
  .max(12000)
  .refine((value) => value.trim().length > 0 && !malformedUnicode.test(value))
  .refine((value) =>
    Array.from(value).every((char) => {
      const point = char.codePointAt(0)!
      return point !== 127 && (point >= 32 || char === '\n' || char === '\r' || char === '\t')
    })
  )
  .refine((value) => encoder.encode(value).byteLength <= 12000)

export const hiveAiTextMessageSchema = z.strictObject({
  role: z.enum(['system', 'user', 'assistant']),
  text
})

/** Request content is never a Grant, permission or spending authorization. */
export const hiveAiTextRequestSchema = z
  .strictObject({
    requestId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    sessionId: hiveAgentSessionIdSchema,
    generationId: hiveAgentGenerationIdSchema,
    ...hiveAiModelSelectionCommandSchema.shape,
    messages: z.array(hiveAiTextMessageSchema).min(1).max(64)
  })
  .refine((value) => value.messages.at(-1)?.role === 'user')
  .refine((value) =>
    value.messages.every((message, index) => message.role !== 'system' || index === 0)
  )
  .refine(
    (value) =>
      value.messages.reduce((sum, message) => sum + encoder.encode(message.text).byteLength, 0) <=
      12000
  )
  .refine((value) => encoder.encode(JSON.stringify(value)).byteLength <= 16384)

export type HiveAiTextRequest = z.infer<typeof hiveAiTextRequestSchema>

export function parseHiveAiTextRequest(value: unknown): HiveAiTextRequest {
  const result = hiveAiTextRequestSchema.safeParse(value)
  if (!result.success) {
    throw new Error('hive_ai_invalid_text_request')
  }
  return result.data
}

/** Matches Hive's recursively sorted UTF-8 JSON; content is never logged or persisted here. */
export function canonicalHiveAiTextRequest(value: unknown): string {
  const request = parseHiveAiTextRequest(value)
  return JSON.stringify({
    generationId: request.generationId,
    messages: request.messages.map(({ role, text }) => ({ role, text })),
    modelId: request.modelId,
    protocol: request.protocol,
    requestId: request.requestId,
    sessionId: request.sessionId,
    snapshotRevision: request.snapshotRevision
  })
}
