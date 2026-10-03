import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { HiveRuntimeSession } from '../../../../shared/hive-runtime-cloud'
import { translate } from '@/i18n/i18n'

export function useHiveRuntimeSessionPage(active: boolean) {
  const [sessions, setSessions] = useState<readonly HiveRuntimeSession[]>([])
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [target, setTarget] = useState<HiveRuntimeSession | null>(null)
  const [revoking, setRevoking] = useState(false)
  const requestGeneration = useRef(0)

  const load = useCallback(async (path: readonly (string | null)[] = [null]): Promise<void> => {
    const generation = ++requestGeneration.current
    setLoading(true)
    setError(false)
    setTarget(null)
    try {
      const result = await window.api.hiveRuntimeCloud.listSessions(path.at(-1))
      if (requestGeneration.current === generation) {
        if (result.nextCursor !== null && path.includes(result.nextCursor)) {
          throw new Error('cursor_loop')
        }
        setSessions(result.items)
        setNextCursor(result.nextCursor)
        setCursors(path)
      }
    } catch {
      if (requestGeneration.current === generation) {
        setError(true)
      }
    } finally {
      if (requestGeneration.current === generation) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (active) {
      void load()
    }
    return () => {
      requestGeneration.current += 1
      setTarget(null)
      setRevoking(false)
    }
  }, [active, load])

  const revoke = async (): Promise<void> => {
    if (!target || revoking) {
      return
    }
    const generation = requestGeneration.current
    setRevoking(true)
    try {
      const updated = await window.api.hiveRuntimeCloud.revokeSession({
        managedSessionId: target.managedSessionId,
        expectedResourceVersion: target.resourceVersion
      })
      if (requestGeneration.current !== generation) {
        return
      }
      setSessions((current) =>
        current.map((session) =>
          session.managedSessionId === updated.managedSessionId
            ? { ...session, ...updated }
            : session
        )
      )
      setTarget(null)
      toast.success(
        translate(
          'auto.components.settings.runtimeSessions.revokeRequested',
          'Runtime session is being ended'
        )
      )
    } catch {
      if (requestGeneration.current !== generation) {
        return
      }
      toast.error(
        translate(
          'auto.components.settings.runtimeSessions.revokeFailed',
          'This Runtime session could not be ended. Try again.'
        )
      )
    } finally {
      if (requestGeneration.current === generation) {
        setRevoking(false)
      }
    }
  }

  return {
    sessions,
    loading,
    error,
    target,
    setTarget,
    revoking,
    revoke,
    page: cursors.length,
    hasNext: nextCursor !== null,
    refresh: () => load(),
    retry: () => load(cursors),
    previous: () => load(cursors.slice(0, -1)),
    next: () => (nextCursor !== null ? load([...cursors, nextCursor]) : undefined)
  }
}
