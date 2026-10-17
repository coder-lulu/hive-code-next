import { useEffect, useRef, useState } from 'react'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { useRpcClientContext } from '../transport/client-context'
import { loadAllAccountRuntimes } from './account-runtime-directory-client'
import { useAccountRuntimeDirectory } from './account-runtime-directory-provider'
import {
  accountRuntimeScopeOf,
  mobileSessionMatchesOperationScope
} from './account-runtime-session-operation'
import { runtimeDeletionSupportedOnThisSurface } from './mobile-runtime-delete-cleanup'
import {
  runtimeDeleteConfirmationName,
  runtimeDeleteFailureState,
  type RuntimeDeleteState
} from './mobile-runtime-delete-state'
import {
  prepareRuntimeDeleteRecovery,
  readRuntimeDeleteRecovery,
  completeRuntimeDeleteRecovery,
  type RuntimeDeleteRecoveryTarget
} from './mobile-runtime-delete-recovery'
import { requestMobileRuntimeUnlinkSms, unlinkMobileRuntime } from './mobile-runtime-unlink-client'

export function useMobileRuntimeDelete(runtimeRecordId: string, session: MobileSession) {
  const auth = useMobileAuthSession()
  const directory = useAccountRuntimeDirectory()
  const { forgetHostClient } = useRpcClientContext()
  const current = useRef({ session: auth.session, runtimeRecordId })
  current.current = { session: auth.session, runtimeRecordId }
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const recoveryTarget = useRef<RuntimeDeleteRecoveryTarget | null>(null)
  const unsupported = !runtimeDeletionSupportedOnThisSurface()
  const [state, setState] = useState<RuntimeDeleteState>(() => ({
    entry: null,
    loading: true,
    busy: false,
    error: null,
    requiresLogin: false,
    uncertain: false,
    cloudConfirmed: false,
    completed: false,
    superseded: false,
    confirmationName: '',
    smsCode: '',
    sms: null,
    resendAt: 0,
    smsExpiresAt: 0,
    smsDailyLimited: false
  }))
  const snapshot = useRef(state)
  const [now, setNow] = useState(Date.now)
  function patch(value: Partial<RuntimeDeleteState>) {
    snapshot.current = { ...snapshot.current, ...value }
    setState(snapshot.current)
  }
  function isCurrent() {
    return (
      mounted.current &&
      current.current.runtimeRecordId === runtimeRecordId &&
      mobileSessionMatchesOperationScope(current.current.session, session)
    )
  }
  function clearProof() {
    patch({ sms: null, smsCode: '', smsExpiresAt: 0 })
  }

  async function cleanup() {
    if (!isCurrent()) {
      return
    }
    patch({ cloudConfirmed: true, uncertain: false })
    clearProof()
    try {
      if (!recoveryTarget.current) {
        throw new Error('runtime_delete_recovery_required')
      }
      const outcome = await completeRuntimeDeleteRecovery(
        session,
        runtimeRecordId,
        forgetHostClient,
        isCurrent,
        {
          target: recoveryTarget.current,
          confirmUnlinked: (expectedVersion) =>
            directory.confirmRuntimeUnlinked(
              runtimeRecordId,
              accountRuntimeScopeOf(session),
              expectedVersion
            )
        }
      )
      if (isCurrent()) {
        patch({ completed: true, superseded: outcome === 'superseded', error: null })
      }
    } catch {
      if (isCurrent()) {
        patch({ error: '已从账号解除认领，但手机连接记录尚未清理完成，请重试清理。' })
      }
    }
  }

  async function run(
    kind: 'review' | 'sms' | 'unlink' | 'cleanup',
    task: (signal: AbortSignal) => Promise<void>
  ) {
    if (!isCurrent() || inFlight.current || unsupported || snapshot.current.requiresLogin) {
      return
    }
    inFlight.current = true
    const active = new AbortController()
    controller.current = active
    patch({ busy: true, error: null })
    try {
      await task(active.signal)
    } catch (failure) {
      if (!isCurrent() || active.signal.aborted) {
        return
      }
      // A previous timed-out write may still commit. Retain the durable intent
      // until local cleanup succeeds, including when a later attempt is rejected.
      patch(runtimeDeleteFailureState(kind, failure))
    } finally {
      inFlight.current = false
      if (isCurrent()) {
        patch({ busy: false, loading: false })
      }
    }
  }

  async function review() {
    if (snapshot.current.cloudConfirmed || snapshot.current.completed) {
      return
    }
    await run('review', async (signal) => {
      clearProof()
      patch({ loading: true, confirmationName: '' })
      const pending = await readRuntimeDeleteRecovery(session, runtimeRecordId)
      if (!isCurrent() || signal.aborted) {
        return
      }
      recoveryTarget.current = pending
      patch({ uncertain: !!pending })
      const entries = await loadAllAccountRuntimes(session, undefined, signal)
      if (!isCurrent() || signal.aborted) {
        return
      }
      const entry = entries.find((item) => item.runtimeRecordId === runtimeRecordId) ?? null
      patch({ entry })
      if (!entry && pending) {
        await cleanup()
      } else {
        patch({
          uncertain: false,
          error: entry ? null : '此 Runtime 已不在当前账号中，无法执行账号删除。'
        })
      }
    })
  }

  async function sendSms() {
    const value = snapshot.current
    if (
      !value.entry ||
      value.cloudConfirmed ||
      value.uncertain ||
      value.completed ||
      value.smsDailyLimited ||
      value.resendAt > Date.now()
    ) {
      return
    }
    await run('sms', async (signal) => {
      clearProof()
      const result = await requestMobileRuntimeUnlinkSms(session, value.entry!, signal)
      if (!isCurrent() || signal.aborted) {
        return
      }
      patch({
        sms: result,
        smsCode: '',
        resendAt: Date.now() + result.resendAfterSeconds * 1000,
        smsExpiresAt: Date.now() + result.expiresInSeconds * 1000
      })
      setNow(Date.now())
    })
  }

  function canConfirm(value: RuntimeDeleteState, time: number) {
    return (
      !!value.entry &&
      !!value.sms &&
      !value.busy &&
      !value.requiresLogin &&
      !unsupported &&
      !value.uncertain &&
      !value.cloudConfirmed &&
      !value.completed &&
      value.smsExpiresAt > time &&
      /^\d{6}$/.test(value.smsCode) &&
      value.confirmationName === runtimeDeleteConfirmationName(value.entry)
    )
  }

  async function confirm() {
    const value = snapshot.current
    if (!canConfirm(value, Date.now())) {
      return
    }
    await run('unlink', async (signal) => {
      try {
        // Persist the target and aliases before a write that may commit even
        // if the app exits. SMS codes and credentials never enter this record.
        recoveryTarget.current = await prepareRuntimeDeleteRecovery(
          session,
          runtimeRecordId,
          value.entry!.resourceVersion
        )
      } catch {
        if (isCurrent()) {
          patch({ error: '无法保存本机清理记录，请稍后重试。' })
        }
        return
      }
      if (!isCurrent() || signal.aborted) {
        return
      }
      await unlinkMobileRuntime(
        session,
        value.entry!,
        {
          smsChallengeId: value.sms!.challengeId,
          smsCode: value.smsCode
        },
        signal
      )
      if (!isCurrent() || signal.aborted) {
        return
      }
      await cleanup()
    })
  }

  async function retryCleanup() {
    if (!snapshot.current.cloudConfirmed || snapshot.current.completed) {
      return
    }
    await run('cleanup', cleanup)
  }

  useEffect(() => {
    mounted.current = true
    if (!unsupported) {
      void review()
    } else {
      patch({ loading: false })
    }
    return () => {
      mounted.current = false
      controller.current?.abort()
    }
    // The screen keys this hook by Runtime and authenticated session identity.
  }, [])
  useEffect(() => {
    if ((!state.sms || state.smsExpiresAt <= now) && state.resendAt <= now) {
      return
    }
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [state.sms, state.smsExpiresAt <= now, state.resendAt <= now])

  return {
    ...state,
    unsupported,
    smsExpired: !!state.sms && state.smsExpiresAt <= now,
    resendRemaining: Math.max(0, Math.ceil((state.resendAt - now) / 1000)),
    canSubmit: canConfirm(state, now),
    setConfirmationName: (confirmationName: string) => {
      if (isCurrent() && !inFlight.current) {
        patch({ confirmationName })
      }
    },
    setSmsCode: (smsCode: string) => {
      if (isCurrent() && !inFlight.current) {
        patch({ smsCode })
      }
    },
    review,
    sendSms,
    confirm,
    retryCleanup
  }
}
