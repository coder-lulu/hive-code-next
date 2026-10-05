import { z } from 'zod'
import {
  isNormalizedHiveRuntimeDisplayName,
  normalizeHiveRuntimeDisplayName
} from '../../../src/shared/hive-runtime-display-name'
import { request } from '../auth/mobile-sms-client'
import type { MobileSession } from '../auth/mobile-sms-auth'
import {
  AccountRuntimeDirectoryEntrySchema,
  type AccountRuntimeDirectoryEntry
} from './account-runtime-directory-types'

const CanonicalUuidSchema = z.uuid().refine((value) => value === value.toLowerCase())
const InstantSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)))
const RuntimeDisplayNamePatchResponseSchema = z
  .object({
    runtimeRecordId: CanonicalUuidSchema,
    cloudDisplayName: z.string().refine(isNormalizedHiveRuntimeDisplayName).nullable(),
    cloudDisplayNameVersion: z.number().int().positive(),
    ownershipEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    updatedAt: InstantSchema
  })
  .strict()

export type RuntimeDisplayNamePatchResponse = z.infer<typeof RuntimeDisplayNamePatchResponseSchema>

export async function loadAccountRuntime(
  session: MobileSession,
  runtimeRecordId: string,
  signal?: AbortSignal
): Promise<AccountRuntimeDirectoryEntry> {
  CanonicalUuidSchema.parse(runtimeRecordId)
  const value = await request<unknown>(
    `/hive/v1/runtimes/${encodeURIComponent(runtimeRecordId)}`,
    undefined,
    {
      method: 'GET',
      headers: bearerHeaders(session.accessToken),
      signal
    }
  )
  return AccountRuntimeDirectoryEntrySchema.parse(value)
}

export async function updateAccountRuntimeDisplayName(
  session: MobileSession,
  runtimeRecordId: string,
  cloudDisplayName: string | null,
  expectedCloudDisplayNameVersion: number,
  signal?: AbortSignal
): Promise<RuntimeDisplayNamePatchResponse> {
  CanonicalUuidSchema.parse(runtimeRecordId)
  const normalizedName =
    cloudDisplayName === null ? null : normalizeHiveRuntimeDisplayName(cloudDisplayName)
  if (
    !Number.isSafeInteger(expectedCloudDisplayNameVersion) ||
    expectedCloudDisplayNameVersion < 1
  ) {
    throw new Error('runtime_display_name_version_invalid')
  }
  const value = await request<unknown>(
    `/hive/v1/runtimes/${encodeURIComponent(runtimeRecordId)}`,
    { cloudDisplayName: normalizedName, expectedCloudDisplayNameVersion },
    {
      method: 'PATCH',
      headers: bearerHeaders(session.accessToken),
      signal
    }
  )
  const parsed = RuntimeDisplayNamePatchResponseSchema.parse(value)
  if (parsed.runtimeRecordId !== runtimeRecordId) {
    throw new Error('runtime_display_name_target_mismatch')
  }
  return parsed
}

function bearerHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}
