import { useCallback, useEffect, useRef, useState } from 'react'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import { MAX_TIMER_DELAY_MS } from '../../../../../shared/timer-delay'
import { subscribeHiveUiAccountBoundary } from './hive-ui-account-boundary'

function signedIn(account: HiveAccountState) {
  return (
    account.configured &&
    account.status === 'signed-in' &&
    account.account &&
    account.errorCode !== 'session_expired' &&
    account.errorCode !== 'session_rejected' &&
    (account.sessionExpiresAt === undefined || account.sessionExpiresAt > Date.now())
  )
}

export function useHiveWorkflowCaseSessionAccount(clear: () => void) {
  const [ready, setReady] = useState(false)
  const [expiryDeadline, setExpiryDeadline] = useState<number | undefined>(undefined)
  const [expirySequence, setExpirySequence] = useState(0)
  const allowed = useRef(false)
  const revoked = useRef(false)
  const deadline = useRef<number | undefined>(undefined)
  const invalidate = useCallback(() => {
    if (revoked.current) {
      return
    }
    revoked.current = true
    allowed.current = false
    setReady(false)
    clear()
  }, [clear])
  useEffect(() => {
    let active = true
    let events = 0
    const observe = (account: HiveAccountState) => {
      if (!active || revoked.current) {
        return
      }
      if (!signedIn(account)) {
        return invalidate()
      }
      allowed.current = true
      setReady(true)
      if (account.sessionExpiresAt !== undefined) {
        deadline.current = account.sessionExpiresAt
        setExpiryDeadline(account.sessionExpiresAt)
      }
    }
    const unsubscribe = subscribeHiveUiAccountBoundary(() => {
      if (active) {
        invalidate()
      }
    })
    const unsubscribeMetadata = window.api.hiveAccount.onStateChanged((account) => {
      events += 1
      observe(account)
    })
    const revision = events
    void window.api.hiveAccount
      .getState()
      .then((account) => {
        if (events === revision) {
          observe(account)
        }
      })
      .catch(() => {
        if (active && events === revision) {
          invalidate()
        }
      })
    return () => {
      active = false
      allowed.current = false
      unsubscribe()
      unsubscribeMetadata()
    }
  }, [invalidate])
  useEffect(() => {
    if (!ready || expiryDeadline === undefined) {
      return
    }
    const remaining = expiryDeadline - Date.now()
    if (remaining <= 0) {
      invalidate()
      return
    }
    const timer = setTimeout(
      () => {
        if (!allowed.current || revoked.current) {
          return
        }
        if (deadline.current !== undefined && deadline.current <= Date.now()) {
          invalidate()
        } else {
          setExpirySequence((previous) => previous + 1)
        }
      },
      Math.min(MAX_TIMER_DELAY_MS, remaining)
    )
    return () => clearTimeout(timer)
  }, [ready, expiryDeadline, expirySequence, invalidate])
  return { ready, allowed, deadline }
}
