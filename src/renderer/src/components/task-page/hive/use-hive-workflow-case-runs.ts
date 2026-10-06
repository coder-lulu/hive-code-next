import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HiveWorkflowCaseRun } from '../../../../../shared/hive-workflow-case-runs'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import { subscribeHiveUiAccountBoundary } from './hive-ui-account-boundary'
import {
  readCancelledWorkflowCaseRun,
  readWorkflowCaseArtifact,
  readWorkflowCaseRun,
  readWorkflowCaseRuns,
  mergeObservedWorkflowCaseRuns,
  workflowCaseRunIsActive,
  workflowCaseStageCanStart,
  recoverWorkflowCaseRunRequest,
  sameWorkflowCaseStart,
  workflowCaseRequestCanReplay,
  workflowCaseRequestStatus,
  createWorkflowCaseStartRequest,
  type HiveWorkflowCaseRunRequest
} from './hive-workflow-case-run-responses'
import {
  emptyWorkflowCaseRunsState as emptyRunsState,
  type HiveWorkflowCaseRunsState as RunsState
} from './hive-workflow-case-run-state'

export function useHiveWorkflowCaseRuns(
  view: HiveWorkflowCaseView | null,
  accountAvailable: boolean,
  reloadCase: (caseId: string) => Promise<boolean>,
  caseBusy = false
) {
  const scope = view ? `${view.binding.scope.projectRef}:${view.id}` : ''
  const [state, setState] = useState(() => emptyRunsState(scope))
  const context = useRef({ view, reloadCase })
  const mounted = useRef(false)
  const revoked = useRef(false)
  const generation = useRef(0)
  const flight = useRef<object | null>(null)
  const observedRuns = useRef<HiveWorkflowCaseRun[]>([])
  const histories = useRef(new Map<string, HiveWorkflowCaseRun[]>())
  // Keep unresolved admission identities when the user visits another case.
  const requests = useRef(new Map<string, HiveWorkflowCaseRunRequest>())
  useLayoutEffect(() => {
    context.current = { view, reloadCase }
  })
  const act = useCallback(
    async <T>(
      pending: NonNullable<RunsState['pending']>,
      operation: (selected: HiveWorkflowCaseView) => Promise<T>,
      receive: (value: T) => void
    ) => {
      const selected = context.current.view
      if (!mounted.current || flight.current || !selected) {
        return false
      }
      const token = {}
      const epoch = generation.current
      const current = () =>
        mounted.current && generation.current === epoch && flight.current === token
      flight.current = token
      setState((previous) => ({ ...previous, pending, error: null }))
      try {
        const value = await Promise.resolve().then(() => {
          if (!current()) {
            throw new Error('STALE_REQUEST')
          }
          return operation(selected)
        })
        if (!current()) {
          return false
        }
        receive(value)
        return true
      } catch (failure) {
        if (current()) {
          setState((previous) => ({
            ...previous,
            error: failure instanceof Error ? failure.message : 'SERVICE_UNAVAILABLE',
            uncertain: Boolean(
              requests.current.get(previous.scope) &&
              !requests.current.get(previous.scope)?.recoveredRunId
            )
          }))
        }
        return false
      } finally {
        if (current()) {
          flight.current = null
          setState((previous) => ({ ...previous, pending: null }))
        }
      }
    },
    []
  )
  const receiveRuns = useCallback((runs: HiveWorkflowCaseRun[]) => {
    const selected = context.current.view
    if (!selected) {
      return
    }
    const scope = `${selected.binding.scope.projectRef}:${selected.id}`
    const request = recoverWorkflowCaseRunRequest(requests.current.get(scope), selected, runs)
    observedRuns.current = runs
    histories.current.set(scope, runs)
    if (request) {
      requests.current.set(scope, request)
    } else {
      requests.current.delete(scope)
    }
    setState((previous) => ({
      ...previous,
      runs,
      loaded: true,
      ...workflowCaseRequestStatus(request, selected, runs)
    }))
  }, [])
  const refresh = useCallback(async () => {
    const selected = context.current.view
    const epoch = generation.current
    const observed = await act(
      'observe',
      async (selected) =>
        readWorkflowCaseRuns(
          await window.api.hiveTasks.getWorkflowCaseRuns({
            projectId: selected.binding.scope.projectRef,
            caseId: selected.id
          }),
          selected
        ),
      (runs) => receiveRuns(mergeObservedWorkflowCaseRuns(observedRuns.current, runs))
    )
    return observed &&
      observedRuns.current.length > 0 &&
      selected &&
      generation.current === epoch &&
      context.current.view === selected
      ? context.current.reloadCase(selected.id)
      : observed
  }, [act, receiveRuns])
  useEffect(() => {
    const admissions = requests.current
    const caseHistories = histories.current
    const unsubscribe = subscribeHiveUiAccountBoundary(() => {
      revoked.current = true
      mounted.current = false
      generation.current += 1
      flight.current = null
      requests.current.clear()
      observedRuns.current = []
      histories.current.clear()
      setState(emptyRunsState(''))
    })
    return () => {
      unsubscribe()
      mounted.current = false
      generation.current += 1
      flight.current = null
      admissions.clear()
      caseHistories.clear()
    }
  }, [])
  useLayoutEffect(() => {
    generation.current += 1
    flight.current = null
    observedRuns.current = histories.current.get(scope) ?? []
    mounted.current = accountAvailable && !revoked.current
    setState({
      ...emptyRunsState(scope),
      runs: observedRuns.current,
      ...(context.current.view
        ? workflowCaseRequestStatus(
            requests.current.get(scope),
            context.current.view,
            observedRuns.current
          )
        : {})
    })
    if (scope && mounted.current) {
      void refresh()
    }
    return () => {
      mounted.current = false
      generation.current += 1
      flight.current = null
    }
  }, [scope, accountAvailable, refresh])
  const visible = state.scope === scope && accountAvailable ? state : emptyRunsState(scope)
  const resumable =
    visible.resumable &&
    visible.runs.some((run) => run.status === 'pending' && run.stageRef === view?.currentStageRef)
  const observing = visible.uncertain || visible.runs.some(workflowCaseRunIsActive)
  useEffect(() => {
    if (!scope || !accountAvailable || !observing) {
      return
    }
    const timer = setInterval(() => {
      void refresh()
    }, 3000)
    return () => clearInterval(timer)
  }, [scope, accountAvailable, observing, refresh])
  const canStart = Boolean(
    view?.executionAvailability.available &&
    visible.loaded &&
    !caseBusy &&
    (visible.uncertain || resumable || workflowCaseStageCanStart(view, visible.runs))
  )
  return {
    ...visible,
    resumable,
    busy: visible.pending !== null,
    canStart,
    refresh,
    clearArtifact: () => setState((previous) => ({ ...previous, artifact: null })),
    start: async () => {
      const selected = context.current.view
      if (
        !mounted.current ||
        flight.current ||
        !canStart ||
        !view ||
        !selected ||
        selected.id !== view.id ||
        (!workflowCaseRequestCanReplay(
          requests.current.get(scope),
          selected,
          observedRuns.current
        ) &&
          !workflowCaseStageCanStart(selected, observedRuns.current))
      ) {
        return false
      }
      const existing = requests.current.get(scope)
      const payload = existing?.input ?? createWorkflowCaseStartRequest(selected)
      requests.current.set(scope, existing ?? { input: payload })
      const admitted = await act(
        'start',
        async (selected) => {
          const run = readWorkflowCaseRun(
            await window.api.hiveTasks.startWorkflowCase(payload),
            selected
          )
          if (!sameWorkflowCaseStart(run.startRequest, payload)) {
            throw new Error('INVALID_RESPONSE')
          }
          return run
        },
        (run) => {
          requests.current.delete(scope)
          receiveRuns(
            [...observedRuns.current.filter((row) => row.task.runId !== run.task.runId), run].slice(
              -96
            )
          )
        }
      )
      if (admitted) {
        await refresh()
      }
      return admitted
    },
    cancel: async (run: HiveWorkflowCaseRun) => {
      if (
        context.current.view?.id !== view?.id ||
        !visible.runs.some((row) => row.task.runId === run.task.runId) ||
        !workflowCaseRunIsActive(run)
      ) {
        return false
      }
      const cancelled = await act(
        'cancel',
        async () =>
          readCancelledWorkflowCaseRun(
            await window.api.hiveTasks.cancel(run.task.taskId, run.task.runId),
            run
          ),
        (updated) =>
          receiveRuns(
            observedRuns.current.map((row) =>
              row.task.runId === updated.task.runId ? updated : row
            )
          )
      )
      if (cancelled) {
        await refresh()
      }
      return cancelled
    },
    readArtifact: (run: HiveWorkflowCaseRun, ref: string) => {
      const selectedRun = visible.runs.find((row) => row.task.runId === run.task.runId)
      if (context.current.view?.id !== view?.id || !selectedRun?.artifactRefs.includes(ref)) {
        return Promise.resolve(false)
      }
      return act(
        'artifact',
        async () =>
          readWorkflowCaseArtifact(
            await window.api.hiveTasks.artifact(run.task.taskId, run.task.runId, ref)
          ),
        (artifact) => setState((previous) => ({ ...previous, artifact }))
      )
    }
  }
}
export type HiveWorkflowCaseRunsModel = ReturnType<typeof useHiveWorkflowCaseRuns>
