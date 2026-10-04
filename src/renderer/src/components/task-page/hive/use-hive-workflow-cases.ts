import { useCallback, useEffect, useRef, useState } from 'react'
import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import type { HiveWorkflowSnapshot } from '../../../../../shared/hive-task-workflows'
import {
  HiveWorkflowCaseCreateSchema,
  HiveWorkflowCaseReadQuerySchema,
  type HiveWorkflowCaseSummary,
  type HiveWorkflowCaseView
} from '../../../../../shared/hive-workflow-cases'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { subscribeHiveUiAccountBoundary } from './hive-ui-account-boundary'
import {
  createWorkflowCaseDraft,
  workflowCaseDraftRefusal,
  workflowCaseInput,
  type HiveWorkflowCaseDraft
} from './hive-workflow-case-draft'
import {
  assertCreatedWorkflowCase,
  mergeWorkflowCaseSummaries,
  readWorkflowCase,
  readWorkflowCasePage,
  summarizeWorkflowCase
} from './hive-workflow-case-responses'

type CasesState = {
  items: HiveWorkflowCaseSummary[]
  nextCursor: string | null
  view: HiveWorkflowCaseView | null
  draft: HiveWorkflowCaseDraft | null
  pending: 'list' | 'read' | 'create' | null
  error: string | null
  accountAvailable: boolean
}
const emptyCasesState = (): CasesState => ({
  items: [],
  nextCursor: null,
  view: null,
  draft: null,
  pending: null,
  error: null,
  accountAvailable: true
})

// The parent keys this hook by account, project and workflow identity, not a case's fixed version.
export function useHiveWorkflowCases(
  team: HiveWorkbenchTeam,
  workflow: HiveWorkflowSnapshot,
  submissionBlocked: boolean
) {
  const [state, setState] = useState(emptyCasesState)
  const mounted = useRef(false)
  const generation = useRef(0)
  const flight = useRef<object | null>(null)
  const request = useRef<{ signature: string; id: string } | null>(null)
  const workflowId = workflow.workflowId
  const act = useCallback(
    async <T>(
      pending: NonNullable<CasesState['pending']>,
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
          readWorkflowCasePage(
            await window.api.hiveTasks.listWorkflowCases({
              projectId: team.project.id,
              workflowId,
              after,
              limit: 25
            }),
            team,
            workflowId,
            after
          ),
        (page) =>
          setState((previous) => ({
            ...previous,
            items: after ? mergeWorkflowCaseSummaries(previous.items, page.items) : page.items,
            nextCursor: page.nextCursor
          }))
      ),
    [act, team, workflowId]
  )
  useEffect(() => {
    mounted.current = true
    void load()
    const unsubscribe = subscribeHiveUiAccountBoundary(() => {
      mounted.current = false
      generation.current += 1
      flight.current = null
      request.current = null
      setState({ ...emptyCasesState(), accountAvailable: false })
    })
    return () => {
      unsubscribe()
      mounted.current = false
      generation.current += 1
      flight.current = null
      request.current = null
    }
  }, [load])
  const canCreate = !submissionBlocked && team.employees.length === 4 && state.accountAvailable
  return {
    ...state,
    canCreate,
    busy: state.pending !== null,
    refusal: state.draft ? workflowCaseDraftRefusal(state.draft, team, workflow) : null,
    refresh: () => load(),
    loadMore: () => (state.nextCursor ? load(state.nextCursor) : Promise.resolve(false)),
    begin: () => {
      if (!mounted.current || flight.current || !canCreate || state.draft) {
        return
      }
      request.current = null
      setState((previous) => ({ ...previous, draft: createWorkflowCaseDraft(), error: null }))
    },
    discard: () => {
      if (!mounted.current || flight.current) {
        return
      }
      request.current = null
      setState((previous) => ({ ...previous, draft: null, error: null }))
    },
    edit: (change: Partial<Pick<HiveWorkflowCaseDraft, 'title' | 'requirement'>>) => {
      if (!mounted.current || flight.current || !state.draft) {
        return
      }
      const changed = { ...state.draft, ...change }
      if (changed.title === state.draft.title && changed.requirement === state.draft.requirement) {
        return
      }
      const requestId = createBrowserUuid()
      request.current = null
      setState((previous) => ({
        ...previous,
        draft: previous.draft ? { ...previous.draft, ...change, requestId } : null,
        error: null
      }))
    },
    select: (caseId: string) => {
      if (!state.items.some((item) => item.id === caseId)) {
        return Promise.resolve(false)
      }
      const query = HiveWorkflowCaseReadQuerySchema.parse({ projectId: team.project.id, caseId })
      return act(
        'read',
        async () => {
          const view = readWorkflowCase(
            await window.api.hiveTasks.getWorkflowCase(query),
            team,
            workflowId
          )
          if (view.id !== caseId) {
            throw new Error('INVALID_RESPONSE')
          }
          return view
        },
        (view) =>
          setState((previous) => ({
            ...previous,
            view,
            items: mergeWorkflowCaseSummaries(previous.items, [summarizeWorkflowCase(view)])
          }))
      )
    },
    create: () => {
      if (!mounted.current || flight.current || !canCreate || !state.draft) {
        return Promise.resolve(false)
      }
      const refusal = workflowCaseDraftRefusal(state.draft, team, workflow)
      if (refusal) {
        setState((previous) => ({ ...previous, error: refusal }))
        return Promise.resolve(false)
      }
      const input = workflowCaseInput(state.draft, team, workflow)
      const signature = JSON.stringify({ ...input, requestId: undefined })
      const id =
        request.current?.signature === signature
          ? request.current.id
          : request.current
            ? createBrowserUuid()
            : state.draft.requestId
      request.current = { signature, id }
      const payload = HiveWorkflowCaseCreateSchema.parse({ ...input, requestId: id })
      return act(
        'create',
        async () => {
          const view = readWorkflowCase(
            await window.api.hiveTasks.createWorkflowCase(payload),
            team,
            workflowId
          )
          assertCreatedWorkflowCase(view, payload)
          return view
        },
        (view) => {
          request.current = null
          setState((previous) => ({
            ...previous,
            view,
            draft: null,
            items: mergeWorkflowCaseSummaries(previous.items, [summarizeWorkflowCase(view)])
          }))
        }
      )
    }
  }
}
export type HiveWorkflowCasesModel = ReturnType<typeof useHiveWorkflowCases>
