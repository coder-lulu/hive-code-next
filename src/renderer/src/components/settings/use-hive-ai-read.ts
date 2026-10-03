import { useCallback, useEffect, useRef, useState } from 'react'

export function useHiveAiRead<T extends { accountId: string }>(
  accountId: string,
  read: () => Promise<T>,
  mutation?: () => Promise<{ accountId: string }>
) {
  const liveAccountId = useRef(accountId)
  liveAccountId.current = accountId
  const [snapshot, setSnapshot] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [activating, setActivating] = useState(false)
  const [activationFailed, setActivationFailed] = useState(false)
  const [showActivating, setShowActivating] = useState(false)
  const writing = useRef(false)
  const reading = useRef(false)
  const generation = useRef(0)
  const authorized = useRef(true)
  const refresh = useCallback(async () => {
    if (
      liveAccountId.current !== accountId ||
      writing.current ||
      !authorized.current ||
      document.visibilityState !== 'visible'
    ) {
      return
    }
    const current = ++generation.current
    reading.current = true
    setSnapshot(null)
    setLoading(true)
    setFailed(false)
    try {
      const next = await read()
      if (current !== generation.current) {
        return
      }
      if (next.accountId !== accountId) {
        throw new Error('hive_ai_account_changed')
      }
      setSnapshot(next)
    } catch {
      if (current === generation.current) {
        setFailed(true)
      }
    } finally {
      if (current === generation.current) {
        reading.current = false
        setLoading(false)
      }
    }
  }, [accountId, read])

  const activate = useCallback(
    async (refreshRelated?: () => Promise<void>) => {
      if (
        !mutation ||
        liveAccountId.current !== accountId ||
        writing.current ||
        reading.current ||
        !authorized.current ||
        document.visibilityState !== 'visible'
      ) {
        return false
      }
      const current = ++generation.current
      writing.current = true
      setActivating(true)
      setActivationFailed(false)
      let rejected = false
      try {
        const result = await mutation()
        if (result.accountId !== accountId) {
          throw new Error('hive_ai_account_changed')
        }
      } catch {
        rejected = true
      }
      if (current !== generation.current) {
        return false
      }
      writing.current = false
      setActivating(false)
      const readGeneration = generation.current + 1
      await Promise.all([refresh(), refreshRelated?.()])
      if (generation.current === readGeneration) {
        setActivationFailed(rejected)
        return true
      }
      return false
    },
    [accountId, mutation, refresh]
  )

  useEffect(() => {
    setShowActivating(false)
    if (!activating) {
      return
    }
    const timer = setTimeout(() => setShowActivating(true), 300)
    return () => clearTimeout(timer)
  }, [activating])

  useEffect(() => {
    const sequence = generation
    authorized.current = true
    if (document.visibilityState === 'visible') {
      void refresh()
    }
    const foreground = () => {
      sequence.current++
      writing.current = false
      reading.current = false
      setActivating(false)
      setActivationFailed(false)
      setSnapshot(null)
      setLoading(false)
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }
    const unsubscribe = window.api.hiveAccount.onStateChanged((state) => {
      authorized.current =
        state?.status === 'signed-in' &&
        state.account?.accountId === accountId &&
        state.errorCode !== 'session_expired' &&
        state.errorCode !== 'session_rejected' &&
        typeof state.expiresAt === 'number' &&
        state.expiresAt > Date.now()
      sequence.current++
      writing.current = false
      reading.current = false
      setActivating(false)
      setActivationFailed(false)
      setSnapshot(null)
      setLoading(false)
      setFailed(!authorized.current)
      if (authorized.current) {
        void refresh()
      }
    })
    document.addEventListener('visibilitychange', foreground)
    return () => {
      sequence.current++
      authorized.current = false
      writing.current = false
      reading.current = false
      unsubscribe()
      document.removeEventListener('visibilitychange', foreground)
    }
  }, [accountId, refresh])

  return {
    snapshot: snapshot?.accountId === accountId ? snapshot : null,
    loading,
    failed,
    refresh,
    activating,
    activationFailed,
    showActivating,
    activate
  }
}
