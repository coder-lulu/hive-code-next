import { z } from 'zod'
import { hiveAgentGenerationIdSchema, hiveAgentSessionIdSchema } from './hive-agent-session-schema'

const operationId = z.string().regex(/^\d{13}-[0-9a-f]{32}$/)
const session = { sessionId: hiveAgentSessionIdSchema }
const cursor = z.strictObject({
  epoch: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative()
})
const historyPage = z
  .strictObject({
    ...session,
    cursor: cursor.optional(),
    direction: z.enum(['tail', 'before', 'after']).optional(),
    limit: z.number().int().min(1).max(100).optional()
  })
  .refine((value) => {
    if (value.direction === 'tail') {
      return value.cursor === undefined
    }
    return !value.direction || value.cursor !== undefined
  })
const schemas = {
  'hiveAgent.create': z.strictObject({
    operationId,
    sessionId: hiveAgentSessionIdSchema,
    profileId: z.string().min(1).max(128)
  }),
  'hiveAgent.read': z.strictObject(session),
  'hiveAgent.binding': z.strictObject(session),
  'hiveAgent.history': historyPage,
  'hiveAgent.subscribe': z.strictObject({ ...session, cursor: cursor.optional() }),
  'hiveAgent.submit': z.strictObject({
    ...session,
    operationId,
    text: z.string().min(1).max(32768)
  }),
  'hiveAgent.cancel': z.strictObject({
    ...session,
    operationId,
    generationId: hiveAgentGenerationIdSchema
  }),
  'hiveAgent.export': historyPage,
  'hiveAgent.delete': z.strictObject({ ...session, operationId })
} as const
export type HiveAgentMethod = keyof typeof schemas
export type HiveAgentMethodMetadata = {
  methodName: HiveAgentMethod
  schemaVersion: 1
  sideEffectClass: 'read' | 'local-state' | 'provider'
  requiredPrincipalKind: 'local'
  requiredMethodScope: HiveAgentMethod
  requiredToolScopes: readonly string[]
  projectScopeMode: 'exact'
  idempotencyMode: 'none' | 'durable-operation'
  maxPayloadClass: 'text-32k'
  schema: z.ZodType
}
export const HIVE_AGENT_METHODS = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]): [HiveAgentMethod, HiveAgentMethodMetadata] => {
    const methodName = name as HiveAgentMethod
    const provider = name === 'hiveAgent.submit' || name === 'hiveAgent.cancel'
    const write = provider || name === 'hiveAgent.create' || name === 'hiveAgent.delete'
    return [
      methodName,
      {
        methodName,
        schemaVersion: 1,
        sideEffectClass: provider ? 'provider' : write ? 'local-state' : 'read',
        requiredPrincipalKind: 'local',
        requiredMethodScope: methodName,
        requiredToolScopes: [],
        projectScopeMode: 'exact',
        idempotencyMode: write ? 'durable-operation' : 'none',
        maxPayloadClass: 'text-32k',
        schema
      }
    ]
  })
) as Record<HiveAgentMethod, HiveAgentMethodMetadata>
export { schemas as hiveAgentMethodSchemas }

/** Constructed by authenticated transport, never from RPC params or bearer-token contents. */
export type AuthenticatedRuntimePrincipal = {
  kind: 'local'
  accountId: string
  deviceId: string
  runtimeRecordId: string
  allowedMethods: readonly string[]
  toolScopes: readonly string[]
  projectScope: string
  expiry: number
  eligibilityRevision: number
  relayConnectionId?: string
}
