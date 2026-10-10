import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { HiveWorkflowPlanApplicationReceipt } from '../../../../../shared/hive-workflow-plan-application'
import type {
  HiveWorkflowPlanGraphView,
  HiveWorkflowPlanGraphStart,
  HiveWorkflowPlanGraphMutation,
  HiveWorkflowPlanGraphRetry,
  HiveWorkflowPlanGraphTask,
  HiveWorkflowPlanGraphOutcome
} from '../../../../../shared/hive-workflow-plan-runs'
import {
  HiveWorkflowPlanGraphStartSchema,
  HiveWorkflowPlanGraphMutationSchema,
  HiveWorkflowPlanGraphRetrySchema
} from '../../../../../shared/hive-workflow-plan-runs'
import { structuredAgentSessionDigest as digest } from '../../../../../shared/structured-agent-session-mutation'
import { useHiveWorkflowCaseSessionAccount } from './use-hive-workflow-case-session-account'
import {
  readWorkflowPlanGraph,
  readWorkflowPlanGraphReply,
  retainWorkflowPlanReport,
  workflowPlanGraphCanResume,
  type WorkflowPlanReport
} from './hive-workflow-plan-graph-responses'

type Operation = 'read' | 'start' | 'cancel' | 'retry' | 'resume' | 'report'
type Mutation =
  | HiveWorkflowPlanGraphStart
  | HiveWorkflowPlanGraphMutation
  | HiveWorkflowPlanGraphRetry
type Fields<T> = T extends Mutation ? Omit<T, 'requestId'> : never
type State = {
  page: HiveWorkflowPlanGraphView | null
  pending: Operation | null
  error: string | null
  report?: WorkflowPlanReport
}
const initial = (): State => ({ page: null, pending: null, error: null })

export function useHiveWorkflowPlanGraph(
  original: HiveWorkflowCaseView,
  application: HiveWorkflowPlanApplicationReceipt
) {
  const [state, setState] = useState(initial)
  const selected = useRef({ original, application })
  selected.current = { original, application }
  const mounted = useRef(false),
    epoch = useRef(0),
    flight = useRef<object | null>(null)
  const pageRef = useRef<HiveWorkflowPlanGraphView | null>(null)
  const request = useRef<{ signature: string; input: Mutation } | null>(null)
  const clear = useCallback(() => {
    epoch.current += 1
    flight.current = null
    pageRef.current = null
    request.current = null
    setState({ ...initial(), error: 'FORBIDDEN' })
  }, [])
  const account = useHiveWorkflowCaseSessionAccount(clear)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      epoch.current += 1
      flight.current = null
      pageRef.current = null
      request.current = null
    }
  }, [])
  const act = useCallback(
    async (
      pending: Operation,
      operation: (current: () => boolean) => Promise<HiveWorkflowPlanGraphView>
    ) => {
      if (
        !mounted.current ||
        !account.allowed.current ||
        flight.current ||
        (account.deadline.current !== undefined && account.deadline.current <= Date.now())
      ) {
        return false
      }
      const token = {},
        generation = epoch.current
      const current = () =>
        mounted.current &&
        account.allowed.current &&
        epoch.current === generation &&
        flight.current === token &&
        (account.deadline.current === undefined || account.deadline.current > Date.now())
      flight.current = token
      setState((previous) => ({ ...previous, pending, error: null }))
      try {
        if (!current()) {
          return false
        }
        const page = await operation(current)
        if (!current()) {
          return false
        }
        const previous = pageRef.current
        if (
          previous?.graph &&
          (!page.graph ||
            page.graph.graphRef !== previous.graph.graphRef ||
            page.graph.revision < previous.graph.revision)
        ) {
          throw new Error('REVISION_CONFLICT')
        }
        pageRef.current = page
        if (['start', 'cancel', 'retry', 'resume'].includes(pending)) {
          request.current = null
        }
        setState((previous) => ({
          ...previous,
          page,
          pending,
          error: null,
          report: retainWorkflowPlanReport(page, previous.report)
        }))
        return true
      } catch (failure) {
        if (current()) {
          setState((previous) => ({
            ...previous,
            error: failure instanceof Error ? failure.message : 'SERVICE_UNAVAILABLE'
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
    [account.allowed, account.deadline]
  )
  const read = useCallback(() => {
    const { original: view, application: receipt } = selected.current
    return act('read', async () =>
      readWorkflowPlanGraph(
        await window.api.hiveTasks.getWorkflowPlanGraph({
          projectId: view.binding.scope.projectRef,
          caseId: view.id,
          applicationRef: receipt.applicationRef
        }),
        view,
        receipt
      )
    )
  }, [act])
  useEffect(() => {
    if (account.ready) {
      void read()
    }
  }, [account.ready, read])
  const active =
    state.page?.graph?.status === 'running' || state.page?.graph?.status === 'cancel_requested'
  useEffect(() => {
    if (!active || !account.ready || state.error) {
      return
    }
    const timer = setInterval(() => {
      void read()
    }, 2000)
    return () => clearInterval(timer)
  }, [active, account.ready, state.error, read])
  const mutate = (operation: 'start' | 'cancel' | 'retry' | 'resume', fields: Fields<Mutation>) => {
    const signature = digest({ operation, fields })
    const input =
      request.current?.signature === signature
        ? request.current.input
        : { ...fields, requestId: createBrowserUuid() }
    request.current = { signature, input }
    const { original: view, application: receipt } = selected.current
    return act(operation, async () => {
      const api = window.api.hiveTasks
      const raw =
        operation === 'start'
          ? await api.startWorkflowPlanGraph(HiveWorkflowPlanGraphStartSchema.parse(input))
          : operation === 'cancel'
            ? await api.cancelWorkflowPlanGraph(HiveWorkflowPlanGraphMutationSchema.parse(input))
            : operation === 'resume'
              ? await api.resumeWorkflowPlanGraph(HiveWorkflowPlanGraphMutationSchema.parse(input))
              : await api.retryWorkflowPlanTask(HiveWorkflowPlanGraphRetrySchema.parse(input))
      return readWorkflowPlanGraphReply(raw, operation, input, view, receipt)
    })
  }
  const query = () => ({
    projectId: selected.current.original.binding.scope.projectRef,
    caseId: selected.current.original.id,
    applicationRef: selected.current.application.applicationRef
  })
  return {
    ...state,
    ready: account.ready,
    busy: state.pending !== null,
    read,
    readReport: (outcome: HiveWorkflowPlanGraphOutcome) => {
      const page = pageRef.current
      if (!page?.outcomes.some((item) => digest(item) === digest(outcome))) {
        return Promise.resolve(false)
      }
      return act('report', async (current) => {
        const report = z
          .strictObject({ name: z.string().min(1).max(240), text: z.string().max(8 * 1024 * 1024) })
          .parse(
            await window.api.hiveTasks.artifact(
              outcome.producer.task.taskId,
              outcome.producer.task.runId,
              outcome.reportVersion.artifactRef
            )
          )
        if (current()) {
          setState((previous) => ({
            ...previous,
            report: {
              taskId: outcome.producer.task.taskId,
              runId: outcome.producer.task.runId,
              outcomeRef: outcome.outcomeRef,
              artifactRef: outcome.reportVersion.artifactRef,
              artifactDigest: outcome.reportVersion.digest,
              name: report.name,
              text: report.text.slice(0, 32_768),
              truncated: report.text.length > 32_768
            }
          }))
        }
        return page
      })
    },
    start: () => {
      const page = pageRef.current
      if (
        !page?.availability.available ||
        page.graph ||
        page.draft.inspection.kind !== 'validated'
      ) {
        return Promise.resolve(false)
      }
      return mutate('start', {
        ...query(),
        expectedCaseRevision: selected.current.original.revision,
        expectedProjectRevision: page.application.projectBindingRevision,
        draftDigest: page.application.draftDigest,
        proposalDigest: page.application.proposalDigest,
        requestedDurationMs: page.draft.inspection.proposal.requestedLimits.maxDurationMs
      })
    },
    cancel: () => {
      const graph = pageRef.current?.graph
      if (!graph || ['done', 'cancelled', 'cancel_requested'].includes(graph.status)) {
        return Promise.resolve(false)
      }
      return mutate('cancel', {
        ...query(),
        graphRef: graph.graphRef,
        expectedGraphRevision: graph.revision
      })
    },
    resume: () => {
      const page = pageRef.current,
        graph = page?.graph
      if (!page || !graph || !workflowPlanGraphCanResume(page)) {
        return Promise.resolve(false)
      }
      return mutate('resume', {
        ...query(),
        graphRef: graph.graphRef,
        expectedGraphRevision: graph.revision
      })
    },
    retry: (task: HiveWorkflowPlanGraphTask) => {
      const graph = pageRef.current?.graph
      if (
        !graph ||
        graph.status !== 'paused' ||
        !task.latestRun ||
        task.blockedReason !== 'failed' ||
        task.latestRun.attempt >= task.maxAttempts
      ) {
        return Promise.resolve(false)
      }
      return mutate('retry', {
        ...query(),
        graphRef: graph.graphRef,
        expectedGraphRevision: graph.revision,
        taskId: task.taskId,
        causeRunId: task.latestRun.runId,
        expectedTaskRevision: task.taskRevision
      })
    }
  }
}
