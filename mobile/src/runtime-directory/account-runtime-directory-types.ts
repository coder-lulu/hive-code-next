import { z } from 'zod'
import { isNormalizedHiveRuntimeDisplayName } from '../../../src/shared/hive-runtime-display-name'

const CanonicalUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), 'Expected canonical UUID')
const InstantSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)))
const PresenceSchema = z.enum(['ONLINE', 'DEGRADED', 'OFFLINE'])
const ReadinessSchema = z.enum(['STARTING', 'READY', 'DEGRADED', 'RECOVERING', 'STOPPED'])
const CredentialStateSchema = z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'REVOKED'])
const RuntimeProtocolVersionSchema = z.union([z.literal(2), z.literal(3)])

const RuntimeProjectionSchema = z
  .object({
    runtimeVersion: z.string().min(1).max(128),
    runtimeProtocolVersion: RuntimeProtocolVersionSchema,
    capabilities: z.array(z.string().min(1).max(128)).max(32),
    readiness: ReadinessSchema,
    readinessReasonCode: z.string().min(1).max(128).nullable().optional(),
    sourceReportedAt: InstantSchema,
    observedAt: InstantSchema,
    freeDiskBytes: z.number().int().nonnegative().nullable().optional(),
    connectionCapabilities: z.array(z.string().min(1).max(128)).max(32).optional()
  })
  .passthrough()

export const AccountRuntimeDirectoryEntrySchema = z
  .object({
    runtimeRecordId: CanonicalUuidSchema,
    cloudDisplayName: z.string().refine(isNormalizedHiveRuntimeDisplayName).nullable().optional(),
    cloudDisplayNameVersion: z.number().int().positive().nullable().optional(),
    status: z.literal('CLAIMED'),
    runtimeVersion: z.string().min(1).max(128),
    runtimeProtocolVersion: RuntimeProtocolVersionSchema,
    capabilities: z.array(z.string().min(1).max(128)).max(32),
    resourceVersion: z.number().int().positive(),
    createdAt: InstantSchema,
    claimedAt: InstantSchema.optional(),
    updatedAt: InstantSchema,
    lastHeartbeatAt: InstantSchema.nullable().optional(),
    presence: PresenceSchema,
    clientAuthMode: z.enum(['MTLS', 'IDENTITY_PROOF']).optional(),
    credentialState: CredentialStateSchema.optional(),
    freeDiskBytes: z.number().int().nonnegative().nullable().optional(),
    connectionCapabilities: z.array(z.string().min(1).max(128)).max(32).optional(),
    deviceName: z.string().min(1).max(255).nullable().optional(),
    projection: RuntimeProjectionSchema.nullable().optional()
  })
  .passthrough()
  .superRefine((entry, context) => {
    if (typeof entry.cloudDisplayName === 'string' && entry.cloudDisplayNameVersion == null) {
      context.addIssue({
        code: 'custom',
        path: ['cloudDisplayNameVersion'],
        message: 'cloudDisplayName requires cloudDisplayNameVersion'
      })
    }
  })
  .transform((entry) => ({
    ...entry,
    claimedAt: entry.claimedAt ?? entry.createdAt,
    lastHeartbeatAt: entry.lastHeartbeatAt ?? entry.projection?.observedAt ?? null,
    readiness: entry.projection?.readiness ?? 'STOPPED',
    readinessReasonCode: entry.projection?.readinessReasonCode ?? null,
    freeDiskBytes: entry.freeDiskBytes ?? entry.projection?.freeDiskBytes ?? null,
    connectionCapabilities:
      entry.connectionCapabilities ?? entry.projection?.connectionCapabilities ?? []
  }))

export type AccountRuntimeDirectoryEntry = z.infer<typeof AccountRuntimeDirectoryEntrySchema>

export type AccountRuntimeDirectoryStatus = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error'

export type AccountRuntimeDirectoryScope = {
  readonly authorityId: string
  readonly accountId: string
}

export type AccountRuntimeDirectoryState = {
  readonly generation: number
  readonly scope: AccountRuntimeDirectoryScope | null
  readonly status: AccountRuntimeDirectoryStatus
  readonly entries: readonly AccountRuntimeDirectoryEntry[]
  readonly loadedAt: number | null
  readonly error: string | null
}

export const RuntimePresenceEntrySchema = z
  .object({
    runtimeRecordId: CanonicalUuidSchema,
    presence: PresenceSchema,
    lastHeartbeatAt: InstantSchema.nullable().optional(),
    readiness: ReadinessSchema.optional(),
    readinessReasonCode: z.string().min(1).max(128).nullable().optional(),
    freeDiskBytes: z.number().int().nonnegative().nullable().optional(),
    observedAt: InstantSchema.optional()
  })
  .strict()
  .transform((entry) => ({
    ...entry,
    lastHeartbeatAt: entry.lastHeartbeatAt ?? null,
    readiness: entry.readiness ?? 'STOPPED',
    readinessReasonCode: entry.readinessReasonCode ?? null,
    freeDiskBytes: entry.freeDiskBytes ?? null,
    observedAt: entry.observedAt ?? null
  }))

export type RuntimePresenceEntry = z.infer<typeof RuntimePresenceEntrySchema>

export const RuntimeSessionSchema = z
  .object({
    managedWebSessionId: CanonicalUuidSchema,
    runtimeRecordId: CanonicalUuidSchema,
    runtimeInstanceId: CanonicalUuidSchema,
    runtimeSessionId: CanonicalUuidSchema,
    clientKind: z.enum(['WEB', 'DESKTOP', 'MOBILE']),
    clientLabel: z.string().min(1).max(128).nullable(),
    status: z.enum(['ACTIVE', 'REVOKE_PENDING', 'REVOKED', 'EXPIRED', 'UNVERIFIABLE']),
    resourceVersion: z.number().int().positive(),
    controlVersion: z.number().int().positive(),
    createdAt: InstantSchema,
    expiresAt: InstantSchema,
    revokeRequestedAt: InstantSchema.nullable(),
    revokeAcknowledgedAt: InstantSchema.nullable()
  })
  .strict()
  .refine(
    (session) => Date.parse(session.expiresAt) > Date.parse(session.createdAt),
    'Runtime session expiry must follow creation'
  )

export type RuntimeSession = z.infer<typeof RuntimeSessionSchema>
