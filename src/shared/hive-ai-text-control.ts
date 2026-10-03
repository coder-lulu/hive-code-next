import { z } from 'zod'
import { hiveAgentGenerationIdSchema } from './hive-agent-session-schema'
import { hiveAiModelSelectionCommandSchema } from './hive-ai-model-catalog'

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const requestId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const epoch = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const hiveAiRuntimeOwnerSchema = z
  .strictObject({ accountId: uuid, deviceId: uuid, runtimeRecordId: uuid })
  .readonly()
export const hiveAiTextControlRequestSchema = z
  .strictObject({
    requestId,
    runtime: z
      .strictObject({
        authorityGeneration: epoch,
        runtimeRecordId: uuid,
        runtimeInstanceId: uuid,
        bootId: uuid,
        heartbeatLeaseId: uuid,
        leaseEpoch: epoch,
        fencingEpoch: epoch
      })
      .readonly()
  })
  .readonly()
export type HiveAiTextControlRequest = z.infer<typeof hiveAiTextControlRequestSchema>
export type HiveAiRuntimeOwner = z.infer<typeof hiveAiRuntimeOwnerSchema>
function integerText(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value)
}
const counter = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .pipe(z.string().refine((value) => BigInt(value) <= 9223372036854775807n))
const usage = z
  .strictObject({
    inputTokens: counter,
    outputTokens: counter,
    totalTokens: counter,
    cachedInputTokens: counter.nullable()
  })
  .refine(
    (value) =>
      [value.inputTokens, value.outputTokens, value.totalTokens].every(integerText) &&
      (value.cachedInputTokens === null || integerText(value.cachedInputTokens)) &&
      BigInt(value.inputTokens) + BigInt(value.outputTokens) === BigInt(value.totalTokens) &&
      (value.cachedInputTokens === null ||
        BigInt(value.cachedInputTokens) <= BigInt(value.inputTokens))
  )
  .readonly()
export const hiveAiTextExecutionSchema = z
  .strictObject({
    gatewayRequestId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{24,128}$/)
      .nullable(),
    status: z.enum(['COMPLETED', 'FAILED', 'INCOMPLETE', 'CANCELLED', 'UNKNOWN']),
    reason: z.enum([
      'TERMINAL',
      'TRUNCATED',
      'REFUSED',
      'UPSTREAM_ERROR',
      'INTERRUPTED',
      'INVALID_STREAM',
      'LIMIT',
      'CANCEL_REQUESTED'
    ]),
    usage: usage.nullable()
  })
  .refine((value) => value.status === 'UNKNOWN' || value.gatewayRequestId !== null)
  .readonly()
export const hiveAiTextControlReplySchema = z
  .strictObject({
    contract: z.literal('hive-ai-text-control-v1'),
    requestId,
    generationId: hiveAgentGenerationIdSchema,
    modelId: hiveAiModelSelectionCommandSchema.shape.modelId,
    protocol: hiveAiModelSelectionCommandSchema.shape.protocol,
    state: z.enum([
      'INTENT_RECORDED',
      'DISPATCHED',
      'COMPLETED',
      'FAILED',
      'UNKNOWN',
      'RECONCILED'
    ]),
    createdAt: z.iso.datetime(),
    execution: hiveAiTextExecutionSchema.nullable()
  })
  .readonly()
export function parseHiveAiTextControlRequest(value: unknown): HiveAiTextControlRequest {
  const result = hiveAiTextControlRequestSchema.safeParse(value)
  if (!result.success) {
    throw new Error('hive_ai_invalid_control_request')
  }
  return result.data
}
export function parseHiveAiTextControlReply(value: unknown, expectedRequestId: string) {
  const result = hiveAiTextControlReplySchema.safeParse(value)
  if (!result.success || result.data.requestId !== expectedRequestId) {
    throw new Error('hive_ai_invalid_control_reply')
  }
  return result.data
}
