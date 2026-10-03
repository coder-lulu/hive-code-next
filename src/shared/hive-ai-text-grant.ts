import { z } from 'zod'
import { hiveAiRuntimeOwnerSchema } from './hive-ai-text-control'
import { hiveAiTextGrantRequestSchema } from './hive-ai-text-grant-request'
import { hiveAiModelSelectionCommandSchema } from './hive-ai-model-catalog'
import { hiveAgentGenerationIdSchema, hiveAgentSessionIdSchema } from './hive-agent-session-schema'

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
  )
const binding = z
  .strictObject({
    ...hiveAiTextGrantRequestSchema.shape.pack.unwrap().shape,
    runtime: hiveAiTextGrantRequestSchema.shape.runtime,
    projectScope: hiveAiTextGrantRequestSchema.shape.projectScope,
    requestId: uuid,
    sessionId: hiveAgentSessionIdSchema,
    generationId: hiveAgentGenerationIdSchema,
    ...hiveAiModelSelectionCommandSchema.shape,
    credentialFence: digest,
    gatewayRevision: revision,
    requestHash: digest
  })
  .readonly()

/** Receipt shape only. Cloud verifies the signature and current authority again before dispatch. */
export const hiveAiSignedTextGrantSchema = z
  .strictObject({
    claims: z
      .strictObject({
        domain: z.literal('hive-ai-text-grant/v1'),
        issuer: z.literal('hive-ai-authority'),
        audience: z.literal('hive-ai-edge'),
        authorityId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
        algorithm: z.literal('Ed25519'),
        grant: z
          .strictObject({
            grantId: uuid,
            owner: hiveAiRuntimeOwnerSchema,
            binding,
            eligibilityRevision: revision,
            nonce: uuid,
            issuedAt: instant,
            expiresAt: instant
          })
          .readonly()
      })
      .readonly(),
    signature: z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/)
  })
  .readonly()
export const hiveAiTextGrantReplySchema = z
  .strictObject({ requestId: uuid, grant: hiveAiSignedTextGrantSchema })
  .readonly()
export type HiveAiSignedTextGrant = z.infer<typeof hiveAiSignedTextGrantSchema>
