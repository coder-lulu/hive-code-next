import { useCallback, useEffect, useRef, useState } from 'react'
import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import { HiveWorkflowReadQuerySchema } from '../../../../../shared/hive-task-workflows'
import {
  workflowDraftFromSnapshot,
  workflowDraftInput,
  workflowDraftRefusal
} from './hive-workflow-draft'
import {
  mergeWorkflowSnapshots,
  readWorkflowPage,
  readWorkflowSnapshot
} from './hive-workflow-responses'
import { emptyWorkflowState, type HiveWorkflowState } from './hive-workflow-editor-state'
import { createHiveWorkflowMutations } from './hive-workflow-mutations'
import { subscribeHiveUiAccountBoundary } from './hive-ui-account-boundary'

// The workbench mounts this hook under the account, project and binding-revision key.
export function useHiveWorkflows(team: HiveWorkbenchTeam) {
  const [state, setState] = useState(emptyWorkflowState)
  const mounted = useRef(false)
  const generation = useRef(0)
  const flight = useRef<object | null>(null)
  const request = useRef<{ signature: string; id: string } | null>(null)
  const act = useCallback(
    async <T>(
      pending: NonNullable<HiveWorkflowState['pending']>,
      operation: () => Promise<T>,
      receive: (value: T) => void
    ) => {
      if (!mounted.current || flight.current) {
        return false
      }
      const token = {}
      const epoch = generation.current
      flight.current = token
      setState((previous) => ({ ...previous, pending, error: null }))
      try {
        const value = await Promise.resolve().then(() => {
          if (!mounted.current || generation.current !== epoch || flight.current !== token) {
            throw new Error('STALE_REQUEST')
          }
          return operation()
        })
        if (!mounted.current || generation.current !== epoch || flight.current !== token) {
          return false
        }
        receive(value)
        return true
      } catch (failure) {
        if (mounted.current && generation.current === epoch && flight.current === token) {
          setState((previous) => ({
            ...previous,
            error: failure instanceof Error ? failure.message : 'SERVICE_UNAVAILABLE'
          }))
        }
        return false
      } finally {
        if (mounted.current && flight.current === token) {
          flight.current = null
          setState((previous) => ({ ...previous, pending: null }))
        }
      }
    },
    []
  )
  const load = useCallback(
    (after?: string) =>
      act(
        'list',
        async () =>
          readWorkflowPage(
            await window.api.hiveTasks.listWorkflows({
              projectId: team.project.id,
              after,
              limit: 25
            }),
            team,
            after
          ),
        (page) =>
          setState((previous) => ({
            ...previous,
            items: after ? mergeWorkflowSnapshots(previous.items, page.items) : page.items,
            nextCursor: page.nextCursor
          }))
      ),
    [act, team]
  )
  useEffect(() => {
    mounted.current = true
    void load()
    const unsubscribe = subscribeHiveUiAccountBoundary(() => {
      generation.current += 1
      mounted.current = false
      flight.current = null
      request.current = null
      setState(emptyWorkflowState())
    })
    return () => {
      unsubscribe()
      mounted.current = false
      generation.current += 1
      flight.current = null
      request.current = null
    }
  }, [load])

  const dirty =
    state.draft !== null &&
    (!state.baseline ||
      JSON.stringify(workflowDraftInput(state.draft, team)) !==
        JSON.stringify(workflowDraftInput(workflowDraftFromSnapshot(state.baseline), team)))
  const latest = state.items.find((item) => item.workflowId === state.baseline?.workflowId)
  const historical = Boolean(
    !dirty &&
    state.baseline &&
    latest &&
    state.baseline.definition.workflowRevision < latest.definition.workflowRevision
  )
  return {
    ...state,
    dirty,
    historical,
    busy: state.pending !== null,
    refusal: state.draft ? workflowDraftRefusal(state.draft, team) : null,
    refresh: () => load(),
    loadMore: () => (state.nextCursor ? load(state.nextCursor) : Promise.resolve(false)),
    select: (workflowId: string, revision?: number) => {
      if (dirty || !state.items.some((item) => item.workflowId === workflowId)) {
        return Promise.resolve(false)
      }
      const query = HiveWorkflowReadQuerySchema.safeParse({
        projectId: team.project.id,
        workflowId,
        revision
      })
      if (!query.success) {
        setState((previous) => ({ ...previous, error: 'INVALID_REQUEST' }))
        return Promise.resolve(false)
      }
      return act(
        'read',
        async () => {
          const snapshot = readWorkflowSnapshot(
            await window.api.hiveTasks.getWorkflow(query.data),
            team
          )
          if (
            snapshot.workflowId !== workflowId ||
            (revision !== undefined && snapshot.definition.workflowRevision !== revision)
          ) {
            throw new Error('INVALID_RESPONSE')
          }
          return snapshot
        },
        (snapshot) => {
          request.current = null
          setState((previous) => ({
            ...previous,
            items: mergeWorkflowSnapshots(previous.items, [snapshot]),
            baseline: snapshot,
            incoming: null,
            draft: workflowDraftFromSnapshot(snapshot)
          }))
        }
      )
    },
    ...createHiveWorkflowMutations({
      team,
      state,
      dirty,
      historical,
      mounted,
      flight,
      request,
      act,
      setState
    })
  }
}
export type HiveWorkflowModel = ReturnType<typeof useHiveWorkflows>
