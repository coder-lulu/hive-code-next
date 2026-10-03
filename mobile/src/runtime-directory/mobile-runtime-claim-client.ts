import { z } from 'zod'
import { randomUUID } from 'expo-crypto'
import { request } from '../auth/mobile-sms-client'
import type { MobileSession } from '../auth/mobile-sms-auth'

const UuidSchema = z.uuid().refine((value) => value === value.toLowerCase())
const VersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const PreviewSchema = z.object({
  challengeId: UuidSchema,
  runtimeRecordId: UuidSchema,
  runtimeVersion: z.string().min(1).max(128),
  expectedVersion: VersionSchema,
  expiresAt: z.iso.datetime({ offset: true })
})
const SmsSchema = z.object({
  challengeId: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/),
  expiresInSeconds: z.number().int().positive().max(86_400),
  resendAfterSeconds: z.number().int().nonnegative().max(86_400),
  phoneNumberMasked: z.string().min(1).max(128)
})
const ApprovalSchema = z.object({
  challengeId: UuidSchema,
  runtimeRecordId: UuidSchema,
  status: z.literal('APPROVED'),
  resourceVersion: VersionSchema
})
export type MobileRuntimeClaimPreview = z.infer<typeof PreviewSchema>
export type MobileRuntimeClaimSms = z.infer<typeof SmsSchema>
type ClaimSession = Pick<MobileSession, 'accessToken'>
const CLAIM_PATH = '/hive/v1/runtime-claim-challenges'

export function normalizeMobileRuntimeClaimCode(value: string): string {
  const code = value.trim().toUpperCase()
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) {
    throw new Error('请输入电脑端显示的认领码，例如 ABCD-EFGH。')
  }
  return code
}

function requireUnexpiredPreview(value: MobileRuntimeClaimPreview) {
  const preview = PreviewSchema.parse(value)
  if (Date.parse(preview.expiresAt) <= Date.now()) {
    throw new Error('认领请求已过期，请在电脑端重新发起。')
  }
  return preview
}

function options(session: ClaimSession, signal?: AbortSignal, idempotencyKey?: string) {
  return {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    signal,
    credentials: 'omit' as const,
    redirect: 'error' as const,
    cache: 'no-store' as const,
    maximumResponseBytes: 16 * 1024
  }
}

export async function previewMobileRuntimeClaim(
  session: ClaimSession,
  code: string,
  signal?: AbortSignal
): Promise<MobileRuntimeClaimPreview> {
  const userCode = normalizeMobileRuntimeClaimCode(code)
  const value = await request<unknown>(
    `${CLAIM_PATH}/preview`,
    { userCode },
    options(session, signal)
  )
  return requireUnexpiredPreview(PreviewSchema.parse(value))
}

export async function startMobileRuntimeClaimSms(
  session: ClaimSession,
  code: string,
  preview: MobileRuntimeClaimPreview,
  signal?: AbortSignal
): Promise<MobileRuntimeClaimSms> {
  const { expectedVersion } = requireUnexpiredPreview(preview)
  const userCode = normalizeMobileRuntimeClaimCode(code)
  return SmsSchema.parse(
    await request<unknown>(
      `${CLAIM_PATH}/sms-challenges`,
      { userCode, expectedVersion },
      options(session, signal)
    )
  )
}

export async function approveMobileRuntimeClaim(
  session: ClaimSession,
  code: string,
  preview: MobileRuntimeClaimPreview,
  sms: MobileRuntimeClaimSms,
  smsCode: string,
  signal?: AbortSignal
) {
  const reviewed = requireUnexpiredPreview(preview)
  const userCode = normalizeMobileRuntimeClaimCode(code)
  const smsChallengeId = SmsSchema.parse(sms).challengeId
  if (!/^\d{6}$/.test(smsCode)) {
    throw new Error('请输入六位短信验证码。')
  }
  const approval = ApprovalSchema.parse(
    await request<unknown>(
      `${CLAIM_PATH}/approve`,
      { userCode, expectedVersion: reviewed.expectedVersion, smsChallengeId, smsCode },
      options(session, signal, randomUUID().replaceAll('-', ''))
    )
  )
  if (
    approval.challengeId !== reviewed.challengeId ||
    approval.runtimeRecordId !== reviewed.runtimeRecordId
  ) {
    throw new Error('认领响应与核对的电脑不一致，请检查电脑端绑定状态。')
  }
  return approval
}
