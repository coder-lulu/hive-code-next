import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  HiveTaskArtifact,
  HiveTaskCreate,
  HiveTaskView
} from '../../../../../shared/hive-tasks'

export function useHiveTasks(open: boolean) {
  const [tasks, setTasks] = useState<HiveTaskView[]>([])
  const [artifact, setArtifact] = useState<HiveTaskArtifact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const locked = useRef(false)
  const refreshFlight = useRef<Promise<void> | null>(null)
  const report = (value: unknown) =>
    setError(value instanceof Error ? value.message : 'SERVICE_UNAVAILABLE')
  const refresh = useCallback(() => {
    if (refreshFlight.current) {
      return refreshFlight.current
    }
    const epoch = generation.current
    const flight = Promise.resolve()
      .then(() => window.api.hiveTasks.list())
      .then((rows) => {
        if (epoch === generation.current) {
          setTasks(rows)
          setError(null)
        }
      })
      .catch((failure: unknown) => {
        if (epoch === generation.current) {
          report(failure)
        }
      })
      .finally(() => {
        if (refreshFlight.current === flight) {
          refreshFlight.current = null
        }
      })
    refreshFlight.current = flight
    return flight
  }, [])
  useEffect(() => {
    if (!open) {
      return
    }
    void refresh()
    const unsubscribe = window.api.hiveAccount.onStateChanged(() => {
      generation.current += 1
      refreshFlight.current = null
      setTasks([])
      setArtifact(null)
      setError(null)
      void refresh()
    })
    return () => {
      unsubscribe()
      generation.current += 1
      refreshFlight.current = null
      setTasks([])
      setArtifact(null)
      setError(null)
    }
  }, [open, refresh])
  useEffect(() => {
    if (
      !open ||
      !tasks.some((task) =>
        ['pending', 'running', 'unknown', 'cancelRequested'].includes(task.status)
      )
    ) {
      return
    }
    const timer = setInterval(() => {
      void refresh()
    }, 3000)
    return () => clearInterval(timer)
  }, [open, tasks, refresh])
  useEffect(
    () => () => {
      generation.current += 1
    },
    []
  )
  const act = async <T>(operation: () => Promise<T>, receive: (value: T) => void) => {
    if (locked.current) {
      return false
    }
    locked.current = true
    setBusy(true)
    setError(null)
    const epoch = generation.current
    try {
      const value = await operation()
      if (epoch !== generation.current) {
        return false
      }
      receive(value)
      await refreshFlight.current
      if (epoch !== generation.current) {
        return false
      }
      await refresh()
      return true
    } catch (failure) {
      if (epoch === generation.current) {
        report(failure)
      }
      return false
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return {
    tasks,
    artifact,
    error,
    busy,
    refresh,
    clearArtifact: () => setArtifact(null),
    create: (input: HiveTaskCreate) =>
      act(
        () => window.api.hiveTasks.create(input),
        () => undefined
      ),
    cancel: (id: string, runId: string) =>
      act(
        () => window.api.hiveTasks.cancel(id, runId),
        () => undefined
      ),
    readArtifact: (id: string, runId: string, ref: string) =>
      act(() => window.api.hiveTasks.artifact(id, runId, ref), setArtifact)
  }
}
