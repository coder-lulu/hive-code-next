import { z } from 'zod'

const InstantSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)))
const CanonicalRuntimeRecordIdSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase())
const RelaySchema = z
  .object({
    cellUrl: z.string().url(),
    relayHostId: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    assignmentEpoch: z.number().int().positive(),
    e2eeFraming: z.union([z.literal('hive-e2ee-v1'), z.literal(2)])
  })
  .strict()
  .refine((relay) => {
    const url = new URL(relay.cellUrl)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  })

const ConnectionIntentSchema = z
  .object({
    connectionIntentId: z.string().min(1).max(128),
    ticketId: z.string().min(1).max(128),
    runtimeRecordId: CanonicalRuntimeRecordIdSchema,
    expiresAt: InstantSchema,
    runtimePublicKeyB64: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    relay: RelaySchema.nullable()
  })
  .strict()

export type HiveRuntimeCloudConnectionIntent = Readonly<{
  connectionIntentId: string
  ticketId: string
  runtimeRecordId: string
  expiresAt: number
  runtimePublicKeyB64: string
  relay: Readonly<{
    cellUrl: string
    relayHostId: string
    assignmentEpoch: number
    e2eeFraming: 'hive-e2ee-v1'
  }> | null
}>

export function normalizeConnectionIntent(value: unknown): HiveRuntimeCloudConnectionIntent {
  const parsed = ConnectionIntentSchema.parse(value)
  return {
    ...parsed,
    expiresAt: Date.parse(parsed.expiresAt),
    relay: parsed.relay ? { ...parsed.relay, e2eeFraming: 'hive-e2ee-v1' } : null
  }
}
