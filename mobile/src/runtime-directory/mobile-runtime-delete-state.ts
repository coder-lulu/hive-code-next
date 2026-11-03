import { resolveHiveRuntimeDisplayName } from '../../../src/shared/hive-runtime-display-name'
import { MobileApiError } from '../auth/mobile-sms-client'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'
import type { MobileRuntimeUnlinkSmsChallenge } from './mobile-runtime-unlink-client'

export type RuntimeDeleteState = {
  entry: AccountRuntimeDirectoryEntry | null
  loading: boolean
  busy: boolean
  error: string | null
  requiresLogin: boolean
  uncertain: boolean
  cloudConfirmed: boolean
  completed: boolean
  superseded: boolean
  confirmationName: string
  smsCode: string
  sms: MobileRuntimeUnlinkSmsChallenge | null
  resendAt: number
  smsExpiresAt: number
  smsDailyLimited: boolean
}

export function runtimeDeleteFailureState(
  kind: 'review' | 'sms' | 'unlink' | 'cleanup',
  failure: unknown
): Partial<RuntimeDeleteState> {
  const clearProof = { sms: null, smsCode: '', smsExpiresAt: 0 }
  if (kind === 'unlink' && runtimeDeleteResultIsUncertain(failure)) {
    return {
      ...clearProof,
      uncertain: true,
      error: '删除结果暂时未知，请先核对删除结果，勿重复提交。'
    }
  }
  const apiError = failure instanceof MobileApiError ? failure : null
  return {
    error: runtimeDeleteErrorMessage(failure),
    requiresLogin: apiError?.status === 401,
    ...(kind === 'unlink' && apiError?.category !== 'runtime_claim_sms_code_rejected'
      ? clearProof
      : {}),
    ...(['unlink', 'sms'].includes(kind) &&
    [404, 409, 410].includes(apiError?.status ?? 0) &&
    apiError?.category !== 'runtime_claim_phone_not_bound'
      ? { ...clearProof, entry: null, confirmationName: '' }
      : {}),
    ...(apiError?.status === 429
      ? {
          resendAt: Date.now() + (apiError.retryAfterMs ?? 60_000),
          smsDailyLimited: apiError.category === 'runtime_claim_sms_daily_limit'
        }
      : {})
  }
}

export function runtimeDeleteConfirmationName(entry: AccountRuntimeDirectoryEntry): string {
  return resolveHiveRuntimeDisplayName({
    cloudDisplayName: entry.cloudDisplayName,
    reportedDeviceName: entry.deviceName,
    runtimeRecordId: entry.runtimeRecordId
  })
}

export function runtimeDeleteResultIsUncertain(failure: unknown): boolean {
  return (
    !(failure instanceof MobileApiError) ||
    failure.status === 0 ||
    failure.status === 408 ||
    failure.status >= 500
  )
}

export function runtimeDeleteErrorMessage(failure: unknown): string {
  if (!(failure instanceof MobileApiError)) {
    return '服务暂时不可用，请检查网络后重试。'
  }
  if (failure.status === 401) {
    return '登录已过期，请重新登录。'
  }
  switch (failure.category) {
    case 'runtime_claim_phone_not_bound':
      return '账号尚未绑定手机号，请先在账号安全设置中绑定。'
    case 'runtime_claim_sms_code_rejected':
      return '短信验证码无效或已过期，请重新核对。'
    case 'runtime_claim_sms_daily_limit':
      return '今日短信发送次数已用完，请明天再试。'
    case 'runtime_claim_account_mismatch':
      return '此 Runtime 不属于当前账号，请重新核对。'
    case undefined:
    default:
      return failure.status === 429
        ? '操作过于频繁，请稍后重试。'
        : '操作未完成，请重新核对 Runtime 后重试。'
  }
}
