import { z } from 'zod'
import { isAgentSessionId } from './agent-session-record'
import { hiveAiModelSelectionCommandSchema } from './hive-ai-model-catalog'
import { hiveAgentTextExecutionBindingSchema } from './hive-agent-text-pack'

export const HIVE_AGENT_SESSION_SCHEMA_VERSION = 1 as const

const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const productId = (kind: string) => z.string().regex(new RegExp(`^ha-${kind}:${UUID_V4}$`))

export const hiveAgentSessionIdSchema = productId('session').brand<'HiveAgentSessionId'>()
export const hiveAgentTurnIdSchema = productId('turn').brand<'HiveAgentTurnId'>()
export const hiveAgentGenerationIdSchema = productId('generation').brand<'HiveAgentGenerationId'>()
export const hiveAgentBindingIdSchema = productId('binding').brand<'HiveAgentBindingId'>()

export type HiveAgentSessionId = z.infer<typeof hiveAgentSessionIdSchema>
export type HiveAgentTurnId = z.infer<typeof hiveAgentTurnIdSchema>
export type HiveAgentGenerationId = z.infer<typeof hiveAgentGenerationIdSchema>
export type HiveAgentBindingId = z.infer<typeof hiveAgentBindingIdSchema>

const reference = z
  .string()
  .min(1)
  .max(512)
  // References must not carry control characters into logs or storage keys.
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]+$/)
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const turnState = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED', 'UNKNOWN'])

export const hiveAgentSessionSchema = z
  .strictObject({
    schemaVersion: z.literal(HIVE_AGENT_SESSION_SCHEMA_VERSION),
    sessionId: hiveAgentSessionIdSchema,
    profileId: reference,
    createdAt: timestamp,
    updatedAt: timestamp,
    visibility: z.literal('private'),
    retention: z.literal('until-deleted'),
    activeGenerationId: hiveAgentGenerationIdSchema.optional(),
    backendBindingRef: hiveAgentBindingIdSchema.optional(),
    stateRevision: revision
  })
  .refine((value) => value.updatedAt >= value.createdAt, { message: 'Invalid session timestamps' })

export const hiveAgentTurnSchema = z
  .strictObject({
    schemaVersion: z.literal(HIVE_AGENT_SESSION_SCHEMA_VERSION),
    turnId: hiveAgentTurnIdSchema,
    sessionId: hiveAgentSessionIdSchema,
    clientOperationId: reference,
    inputRef: reference,
    state: turnState,
    createdAt: timestamp,
    finalizedAt: timestamp.optional()
  })
  .refine((value) => value.finalizedAt === undefined || value.finalizedAt >= value.createdAt, {
    message: 'Invalid turn timestamps'
  })

export const hiveAgentGenerationSchema = z
  .strictObject({
    schemaVersion: z.literal(HIVE_AGENT_SESSION_SCHEMA_VERSION),
    generationId: hiveAgentGenerationIdSchema,
    turnId: hiveAgentTurnIdSchema,
    providerBindingRef: hiveAgentBindingIdSchema,
    capabilityRevision: revision,
    modelSelection: hiveAiModelSelectionCommandSchema.optional(),
    executionBinding: hiveAgentTextExecutionBindingSchema.optional(),
    state: turnState,
    finalReceiptRef: reference.optional()
  })
  .refine(
    (value) =>
      !value.executionBinding || value.executionBinding.protocol === value.modelSelection?.protocol,
    { message: 'Generation execution protocol mismatch', path: ['executionBinding', 'protocol'] }
  )

export const hiveAgentBindingSchema = z.strictObject({
  schemaVersion: z.literal(HIVE_AGENT_SESSION_SCHEMA_VERSION),
  bindingId: hiveAgentBindingIdSchema,
  providerKind: z.enum(['managed-pi', 'codex', 'claude']),
  providerSessionRef: reference,
  runtimeRecordRef: z
    .string()
    .refine(isAgentSessionId, { message: 'Invalid runtime record reference' }),
  capabilityRevision: revision,
  capabilities: z.array(z.literal('local.text')).max(1),
  // Shape validation only; the host must resolve and authorize this vault reference.
  encryptedSecretRef: reference.optional()
})

export type HiveAgentSession = z.infer<typeof hiveAgentSessionSchema>
export type HiveAgentTurn = z.infer<typeof hiveAgentTurnSchema>
export type HiveAgentGeneration = z.infer<typeof hiveAgentGenerationSchema>
export type HiveAgentBinding = z.infer<typeof hiveAgentBindingSchema>

export const HIVE_AGENT_SESSION_ERROR_CODES = [
  'hive_agent_invalid_request',
  'hive_agent_forbidden',
  'hive_agent_capability_unavailable',
  'hive_agent_operation_conflict',
  'hive_agent_outcome_unknown',
  'hive_agent_stale_generation',
  'hive_agent_model_unavailable',
  'hive_agent_pack_unavailable'
] as const

export const hiveAgentSessionErrorSchema = z.strictObject({
  code: z.enum(HIVE_AGENT_SESSION_ERROR_CODES)
})
