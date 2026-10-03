import { z } from 'zod'
import { hiveAiTextControlRequestSchema } from './hive-ai-text-control'
import { hiveAiTextRequestSchema } from './hive-ai-text-request'

/** Signed declarations only; current identity, entitlement and cost policy remain server-owned. */
export const hiveAiTextGrantRequestSchema = z
  .strictObject({
    runtime: hiveAiTextControlRequestSchema.unwrap().shape.runtime,
    projectScope: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    pack: z
      .strictObject({
        packRevision: z.string().regex(/^[a-f0-9]{64}$/),
        profileId: z.literal('personal'),
        toolPolicy: z.literal('empty'),
        inputLimit: z.number().int().min(1).max(16000),
        outputLimit: z.number().int().min(1).max(2000)
      })
      .readonly(),
    request: hiveAiTextRequestSchema
  })
  .refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 16384)

export function parseHiveAiTextGrantRequest(value: unknown) {
  const parsed = hiveAiTextGrantRequestSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('hive_ai_invalid_text_grant_request')
  }
  return Object.freeze({
    ...parsed.data,
    request: Object.freeze({
      ...parsed.data.request,
      messages: Object.freeze(parsed.data.request.messages.map((message) => Object.freeze(message)))
    })
  })
}
export type HiveAiTextGrantRequest = ReturnType<typeof parseHiveAiTextGrantRequest>
