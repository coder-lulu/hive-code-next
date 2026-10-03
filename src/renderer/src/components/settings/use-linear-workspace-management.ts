import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { LinearWorkspace } from '../../../../shared/linear/workspace-types'
import { integrationText as text } from './integration-settings-row'
type Result = { ok: boolean; error?: string }
export function useLinearWorkspaceManagement() {
  const testConnection = useAppStore((state) => state.testLinearConnection)
  const refresh = useAppStore((state) => state.checkLinearConnection)
  const disconnect = useAppStore((state) => state.disconnectLinearWorkspace)
  const mounted = useMountedRef()
  const pending = useRef(new Map<string, number>())
  const authorizationGeneration = useRef(0)
  const [testing, setTesting] = useState<ReadonlySet<string>>(new Set())
  const [results, setResults] = useState<Record<string, Result>>({})
  const [editingWorkspace, setEditingWorkspace] = useState<LinearWorkspace | null>(null)
  const [authorize, setAuthorize] = useState(false)
  const [remove, setRemove] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runTest = async (id: string) => {
    if (pending.current.has(id)) {
      return
    }
    const generation = authorizationGeneration.current
    pending.current.set(id, generation)
    setTesting(new Set(pending.current.keys()))
    setResults((previous) => {
      const next = { ...previous }
      delete next[id]
      return next
    })
    try {
      const result = await testConnection(id)
      if (mounted.current && generation === authorizationGeneration.current) {
        setResults((previous) => ({ ...previous, [id]: result }))
      }
    } catch (failure) {
      if (mounted.current && generation === authorizationGeneration.current) {
        setResults((previous) => ({
          ...previous,
          [id]: {
            ok: false,
            error:
              failure instanceof Error
                ? failure.message
                : text(
                    'testFailed',
                    'Could not test this workspace. Retry or update its access key.'
                  )
          }
        }))
      }
    } finally {
      if (pending.current.get(id) === generation) {
        pending.current.delete(id)
        if (mounted.current) {
          setTesting(new Set(pending.current.keys()))
        }
      }
    }
  }
  const removeWorkspace = async () => {
    if (!remove || removing) {
      return
    }
    setRemoving(true)
    setError(null)
    try {
      await disconnect(remove.id)
      if (mounted.current) {
        setRemove(null)
        setResults((previous) => {
          const next = { ...previous }
          delete next[remove.id]
          return next
        })
      }
    } catch (failure) {
      if (mounted.current) {
        setError(
          failure instanceof Error
            ? failure.message
            : text('removeFailed', 'Could not remove access. Retry.')
        )
      }
    } finally {
      if (mounted.current) {
        setRemoving(false)
      }
    }
  }
  const authorizationCompleted = () => {
    authorizationGeneration.current += 1
    pending.current.clear()
    setTesting(new Set())
    setResults({})
    toast.success(text('connected', 'Connected'))
    void refresh(true)
  }
  return {
    authorizationCompleted,
    testing,
    results,
    editingWorkspace,
    setEditingWorkspace,
    authorize,
    setAuthorize,
    remove,
    setRemove,
    removing,
    error,
    setError,
    runTest,
    removeWorkspace
  }
}
