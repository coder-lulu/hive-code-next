import { useCallback, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import type { MobileSession } from '../auth/mobile-sms-session'
import { MobileAiCloudUnauthorizedError } from './mobile-ai-cloud-error'

export function useMobileAiCloudRead<T>(
  read: (session: MobileSession, signal: AbortSignal) => Promise<T>,
  mutation?: (session: MobileSession, signal: AbortSignal) => Promise<unknown>
) {
  const { session, hydrated, refresh: refreshSession } = useMobileAuthSession()
  const liveSession = useRef(session)
  liveSession.current = session
  const active = useRef(AppState.currentState === 'active')
  const focused = useRef(false)
  const recoveredOwner = useRef<string | null>(null)
  const generation = useRef(0)
  const writing = useRef(false)
  const reading = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const [state, setState] = useState<{
    session: MobileSession | null
    snapshot: T | null
    loading: boolean
    failed: boolean
    activating?: boolean
    activationFailed?: boolean
  }>({ session: null, snapshot: null, loading: false, failed: false })
  const refresh = useCallback(async () => {
    if (writing.current || liveSession.current !== session || !focused.current || !active.current) {
      return
    }
    const current = ++generation.current
    reading.current = !!session
    controller.current?.abort()
    const operation = new AbortController()
    controller.current = operation
    setState({ session, snapshot: null, loading: !!session, failed: false })
    if (!session) {
      return
    }
    const owner = `${session.authorityId}:${session.account.accountId}`
    const isCurrent = () =>
      current === generation.current &&
      liveSession.current === session &&
      focused.current &&
      active.current &&
      !operation.signal.aborted
    const recover = async () => {
      if (!isCurrent() || recoveredOwner.current === owner) {
        return false
      }
      recoveredOwner.current = owner
      try {
        await refreshSession()
        return true
      } catch (error) {
        if (isCurrent()) {
          recoveredOwner.current = null
        }
        throw error
      }
    }
    try {
      if (session.expiresAt <= Date.now()) {
        if (await recover()) {
          return
        }
        throw new MobileAiCloudUnauthorizedError()
      }
      const snapshot = await read(session, operation.signal)
      if (isCurrent()) {
        recoveredOwner.current = null
        setState({ session, snapshot, loading: false, failed: false })
      }
    } catch (error) {
      if (error instanceof MobileAiCloudUnauthorizedError && isCurrent()) {
        try {
          if (await recover()) {
            return
          }
        } catch {
          // Auth owns terminal refresh failures and clears the rejected session.
        }
      }
      if (isCurrent()) {
        setState({ session, snapshot: null, loading: false, failed: true })
      }
    } finally {
      if (current === generation.current) {
        reading.current = false
        setState((previous) => ({ ...previous, loading: false }))
      }
    }
  }, [session, refreshSession, read])

  const activate = useCallback(
    async (refreshRelated?: () => Promise<void>) => {
      if (
        !mutation ||
        !session ||
        liveSession.current !== session ||
        writing.current ||
        reading.current ||
        !focused.current ||
        !active.current
      ) {
        return false
      }
      const current = ++generation.current
      const operation = new AbortController()
      controller.current?.abort()
      controller.current = operation
      writing.current = true
      setState((previous) => ({ ...previous, session, activating: true, activationFailed: false }))
      let rejected = false
      try {
        await mutation(session, operation.signal)
      } catch {
        rejected = true
      }
      if (current !== generation.current || liveSession.current !== session) {
        return false
      }
      writing.current = false
      setState((previous) => ({ ...previous, activating: false }))
      const readGeneration = generation.current + 1
      await Promise.all([refresh(), refreshRelated?.()])
      if (generation.current === readGeneration && liveSession.current === session) {
        setState((previous) => ({ ...previous, activationFailed: rejected }))
        return true
      }
      return false
    },
    [session, mutation, refresh]
  )

  useFocusEffect(
    useCallback(() => {
      const sequence = generation
      const activeController = controller
      focused.current = true
      active.current = AppState.currentState === 'active'
      void refresh()
      const subscription = AppState.addEventListener('change', (next) => {
        active.current = next === 'active'
        if (next === 'active') {
          void refresh()
        } else {
          sequence.current++
          writing.current = false
          reading.current = false
          activeController.current?.abort()
          setState({ session, snapshot: null, loading: false, failed: false })
        }
      })
      return () => {
        focused.current = false
        sequence.current++
        writing.current = false
        reading.current = false
        activeController.current?.abort()
        subscription.remove()
      }
    }, [refresh, session])
  )

  return {
    hydrated,
    signedIn: session !== null,
    snapshot: state.session === session ? state.snapshot : null,
    loading: state.session === session && state.loading,
    failed: state.session === session && state.failed,
    activating: state.session === session && (state.activating ?? false),
    activationFailed: state.session === session && (state.activationFailed ?? false),
    activate,
    refresh
  }
}
