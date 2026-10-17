import { z } from 'zod'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { request } from '../auth/mobile-sms-client'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'

const CanonicalUuidSchema = z.uuid().refine((value) => value === value.toLowerCase())
const VersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const ChallengeIdSchema = z.string().regex(/^[0-9a-f]{32}$/)
const TargetSchema = z.object({
  runtimeRecordId: CanonicalUuidSchema,
  resourceVersion: VersionSchema
})
const SmsChallengeSchema = z.object({
  challengeId: ChallengeIdSchema,
  phoneNumberMasked: z.string().trim().min(1),
  expiresInSeconds: VersionSchema,
  resendAfterSeconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
})
const ProofSchema = z.object({
  smsChallengeId: ChallengeIdSchema,
  smsCode: z.string().regex(/^[0-9]{6}$/)
})
const UnlinkResultSchema = z.object({
  runtimeRecordId: CanonicalUuidSchema,
  status: z.literal('UNLINKED'),
  authorityGeneration: VersionSchema,
  fencingEpoch: VersionSchema,
  resourceVersion: VersionSchema,
  unlinkedAt: z.iso.datetime({ offset: true })
})

export type MobileRuntimeUnlinkTarget = Pick<
  AccountRuntimeDirectoryEntry,
  'runtimeRecordId' | 'resourceVersion'
>
export type MobileRuntimeUnlinkSmsChallenge = z.infer<typeof SmsChallengeSchema>
export type MobileRuntimeUnlinkResult = z.infer<typeof UnlinkResultSchema>

function options(session: MobileSession, signal?: AbortSignal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('runtime_unlink_cancelled'), { name: 'AbortError' })
  }
  return {
    method: 'POST' as const,
    headers: { Authorization: `Bearer ${session.accessToken}` },
    credentials: 'omit' as const,
    redirect: 'error' as const,
    cache: 'no-store' as const,
    maximumResponseBytes: 16 * 1024,
    signal
  }
}

export async function requestMobileRuntimeUnlinkSms(
  session: MobileSession,
  target: MobileRuntimeUnlinkTarget,
  signal?: AbortSignal
): Promise<MobileRuntimeUnlinkSmsChallenge> {
  const { runtimeRecordId, resourceVersion } = TargetSchema.parse(target)
  return SmsChallengeSchema.parse(
    await request<unknown>(
      `/hive/v1/runtimes/${runtimeRecordId}/unlink/sms-challenges`,
      { expectedVersion: resourceVersion },
      options(session, signal)
    )
  )
}

export async function unlinkMobileRuntime(
  session: MobileSession,
  target: MobileRuntimeUnlinkTarget,
  proof: { smsChallengeId: string; smsCode: string },
  signal?: AbortSignal
): Promise<MobileRuntimeUnlinkResult> {
  const { runtimeRecordId, resourceVersion } = TargetSchema.parse(target)
  const { smsChallengeId, smsCode } = ProofSchema.parse(proof)
  // SMS proofs are single-use; this mutation has no idempotency contract.
  const result = UnlinkResultSchema.parse(
    await request<unknown>(
      `/hive/v1/runtimes/${runtimeRecordId}/unlink`,
      { expectedVersion: resourceVersion, smsChallengeId, smsCode },
      options(session, signal)
    )
  )
  if (result.runtimeRecordId !== runtimeRecordId || result.resourceVersion <= resourceVersion) {
    throw new Error('runtime_unlink_response_mismatch')
  }
  return result
}
