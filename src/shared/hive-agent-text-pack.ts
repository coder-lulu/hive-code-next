import { z } from 'zod'
import { hiveAiProtocolSchema } from './hive-ai-model-catalog'

const revision = z.string().regex(/^[a-f0-9]{64}$/)
const profileId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
const version = z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/)
const protocols = z
  .array(hiveAiProtocolSchema)
  .max(2)
  .refine((items) => new Set(items).size === items.length)
const tokenCeiling = z.number().int().positive().max(1_000_000)
const profile = z.strictObject({
  profileId,
  protocols,
  toolPolicy: z.literal('empty'),
  maxInputTokens: tokenCeiling,
  maxOutputTokens: tokenCeiling
})

/** Capability declaration only; the trusted loader must attest installed Pack artifacts. */
export const hiveAgentTextPackManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packRevision: revision,
  nodeVersion: version,
  piCoreVersion: version,
  piAiVersion: version,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  platform: z.enum(['win32', 'darwin', 'linux']),
  architecture: z.enum(['x64', 'arm64']),
  capabilities: z.array(z.literal('local.text')).max(1),
  protocols,
  profiles: z
    .array(profile)
    .max(8)
    .refine((items) => new Set(items.map((item) => item.profileId)).size === items.length)
})

/** Durable local ceilings; authoritative model/Grant admission must narrow them further. */
export const hiveAgentTextExecutionBindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packRevision: revision,
  profileId,
  protocol: hiveAiProtocolSchema,
  toolPolicy: z.literal('empty'),
  maxInputTokens: tokenCeiling.max(16_000),
  maxOutputTokens: tokenCeiling.max(2_000)
})

export type HiveAgentTextPackManifest = z.infer<typeof hiveAgentTextPackManifestSchema>
export type HiveAgentTextExecutionBinding = z.infer<typeof hiveAgentTextExecutionBindingSchema>
