import { useEffect, useRef, useState } from 'react'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { MobileApiError } from '../auth/mobile-sms-client'
import {
  approveMobileRuntimeClaim,
  normalizeMobileRuntimeClaimCode,
  previewMobileRuntimeClaim,
  startMobileRuntimeClaimSms,
  type MobileRuntimeClaimPreview,
  type MobileRuntimeClaimSms
} from './mobile-runtime-claim-client'

function errorMessage(failure: unknown): string {
  if (failure instanceof MobileApiError) {
    if (failure.status === 401) {
      return '登录已过期，请重新登录后认领。'
    }
    if (failure.status === 429) {
      return '操作过于频繁，请稍后重试。'
    }
    switch (failure.category) {
      case 'runtime_claim_account_mismatch':
        return '请使用电脑端登录的同一 HiveCloud 账号认领。'
      case 'runtime_claim_phone_not_bound':
        return '账号尚未绑定手机号，请先在账号安全设置中绑定。'
      case 'runtime_claim_sms_code_rejected':
        return '短信验证码无效或已过期，请重试。'
      case 'runtime_claim_recovery_gone':
        return '认领请求已过期或取消，请在电脑端重新发起。'
      case 'runtime_claim_recovery_conflict':
        return '电脑状态已变化，请重新核对认领码。'
      default:
        return '认领服务暂时不可用，请检查网络或稍后重试。'
    }
  }
  return failure instanceof Error && !('issues' in failure)
    ? failure.message
    : '认领服务返回了无效信息，请稍后重试。'
}

export function useMobileRuntimeClaim(session: MobileSession) {
  const [code, setCode] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [preview, setPreview] = useState<MobileRuntimeClaimPreview | null>(null)
  const [sms, setSms] = useState<MobileRuntimeClaimSms | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [requiresLogin, setRequiresLogin] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [resendAt, setResendAt] = useState(0)
  const [smsExpiresAt, setSmsExpiresAt] = useState(0)
  const inFlight = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
      clearInterval(timer)
    }
  }, [])

  const expired = !!preview && Date.parse(preview.expiresAt) <= now
  const smsExpired = !!sms && smsExpiresAt <= now
  const resendRemaining = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const unavailable = busy || approved || uncertain || requiresLogin || expired

  async function run(
    operation: 'preview' | 'sms' | 'approve',
    task: (signal: AbortSignal) => Promise<void>
  ) {
    if (inFlight.current || !mountedRef.current) {
      return
    }
    inFlight.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setError(null)
    try {
      await task(controller.signal)
    } catch (failure) {
      if (controller.signal.aborted || !mountedRef.current) {
        return
      }
      if (
        operation === 'approve' &&
        (!(failure instanceof MobileApiError) ||
          failure.status === 0 ||
          failure.status === 408 ||
          failure.status >= 500)
      ) {
        // Approval may have reached Cloud; require a desktop check instead of replaying it.
        setUncertain(true)
        setSms(null)
        setSmsCode('')
        setError('确认结果暂时未知，请检查电脑端是否已绑定；未绑定时请在电脑端重新发起认领。')
      } else {
        setError(errorMessage(failure))
        if (failure instanceof MobileApiError) {
          if (failure.status === 401) {
            setRequiresLogin(true)
          }
          if (
            failure.category === 'runtime_claim_recovery_conflict' ||
            failure.category === 'runtime_claim_recovery_gone'
          ) {
            setPreview(null)
            setSms(null)
            setSmsCode('')
          }
          if (failure.status === 429) {
            setResendAt(Date.now() + (failure.retryAfterMs ?? 60_000))
          }
        }
      }
    } finally {
      inFlight.current = false
      if (!controller.signal.aborted && mountedRef.current) {
        setBusy(false)
      }
    }
  }

  async function review() {
    if (busy || approved || uncertain || requiresLogin) {
      return
    }
    let userCode: string
    try {
      userCode = normalizeMobileRuntimeClaimCode(code)
    } catch (failure) {
      setError(errorMessage(failure))
      return
    }
    setPreview(null)
    setSms(null)
    setSmsCode('')
    await run('preview', async (signal) => {
      const result = await previewMobileRuntimeClaim(session, userCode, signal)
      if (signal.aborted || !mountedRef.current) {
        return
      }
      setCode(userCode)
      setPreview(result)
      setNow(Date.now())
    })
  }

  async function sendSms() {
    if (
      unavailable ||
      !preview ||
      resendAt > Date.now() ||
      Date.parse(preview.expiresAt) <= Date.now()
    ) {
      return
    }
    await run('sms', async (signal) => {
      const result = await startMobileRuntimeClaimSms(session, code, preview, signal)
      if (signal.aborted || !mountedRef.current) {
        return
      }
      setSms(result)
      setSmsCode('')
      setResendAt(Date.now() + result.resendAfterSeconds * 1000)
      setSmsExpiresAt(
        Math.min(Date.parse(preview.expiresAt), Date.now() + result.expiresInSeconds * 1000)
      )
      setNow(Date.now())
    })
  }

  async function confirm() {
    if (
      unavailable ||
      !preview ||
      !sms ||
      smsExpiresAt <= Date.now() ||
      Date.parse(preview.expiresAt) <= Date.now()
    ) {
      return
    }
    if (!/^\d{6}$/.test(smsCode.trim())) {
      setError('请输入六位短信验证码。')
      return
    }
    await run('approve', async (signal) => {
      await approveMobileRuntimeClaim(session, code, preview, sms, smsCode.trim(), signal)
      if (signal.aborted || !mountedRef.current) {
        return
      }
      setApproved(true)
      setSmsCode('')
      setSms(null)
    })
  }

  function reset() {
    if (busy || uncertain || approved) {
      return
    }
    setPreview(null)
    setSms(null)
    setSmsCode('')
    setError(null)
  }

  return {
    code,
    setCode,
    smsCode,
    setSmsCode,
    preview,
    sms,
    busy,
    error,
    approved,
    uncertain,
    requiresLogin,
    expired,
    smsExpired,
    resendRemaining,
    unavailable,
    review,
    sendSms,
    confirm,
    reset
  }
}
