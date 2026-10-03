import { useCallback, useEffect, useRef, useState } from 'react'
import type { HiveAccountState } from '../../../shared/hive-account'
import { useMountedRef } from './useMountedRef'

export function shouldShowMobileButton(
  state: Pick<HiveAccountState, 'status'> | null | undefined
): boolean {
  return state != null && state.status !== 'signed-in'
}

export function useHiveAccountState() {
  const [state, setState] = useState<HiveAccountState | null>(null)
  const revision = useRef(0)
  const mountedRef = useMountedRef()
  const commitState = useCallback(
    (next: HiveAccountState): void => {
      if (mountedRef.current) {
        revision.current += 1
        setState(next)
      }
    },
    [mountedRef]
  )
  const refreshState = useCallback(
    async (showReadError = true): Promise<void> => {
      const readRevision = ++revision.current
      try {
        const next = await window.api.hiveAccount.getState()
        if (mountedRef.current && revision.current === readRevision) {
          setState(next)
        }
      } catch {
        if (showReadError && mountedRef.current && revision.current === readRevision) {
          setState({
            configured: true,
            status: 'error',
            persistence: 'none',
            errorCode: 'authorization_failed'
          })
        }
      }
    },
    [mountedRef]
  )
  useEffect(() => {
    const unsubscribe = window.api.hiveAccount.onStateChanged(commitState)
    const onFocus = (): void => {
      void refreshState()
    }
    void refreshState()
    window.addEventListener('focus', onFocus)
    return () => {
      revision.current += 1
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [commitState, refreshState])
  return { state, commitState, refreshState }
}
