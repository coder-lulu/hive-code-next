import { useCallback, useEffect, useRef, useState } from 'react'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { WorkflowPlanDraft } from '../../../../../shared/task-workflow/workflow-plan-draft'
import type {
  HiveWorkflowPlanApply,
  HiveWorkflowPlanApplicationView
} from '../../../../../shared/hive-workflow-plan-application'
import { structuredAgentSessionDigest as digest } from '../../../../../shared/structured-agent-session-mutation'
import { useHiveWorkflowCaseSessionAccount } from './use-hive-workflow-case-session-account'
import {
  readWorkflowPlanApplication,
  readWorkflowPlanApplyReply
} from './hive-workflow-plan-application-responses'

type State = {
  page: HiveWorkflowPlanApplicationView | null
  pending: 'read' | 'apply' | null
  error: string | null
}
const initial = (): State => ({ page: null, pending: null, error: null })

export function useHiveWorkflowPlanApplication(
  view: HiveWorkflowCaseView,
  draft: WorkflowPlanDraft
) {
  const [state, setState] = useState(initial)
  const mounted = useRef(false)
  const generation = useRef(0)
  const flight = useRef<object | null>(null)
  const selected = useRef({ view, draft })
  selected.current = { view, draft }
  const pageRef = useRef<HiveWorkflowPlanApplicationView | null>(null)
  const request = useRef<{ signature: string; input: HiveWorkflowPlanApply } | null>(null)
  const clear = useCallback(() => {
    generation.current += 1
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
      generation.current += 1
      flight.current = null
      pageRef.current = null
      request.current = null
    }
  }, [])
  const act = async (
    pending: NonNullable<State['pending']>,
    operation: () => Promise<HiveWorkflowPlanApplicationView>
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
      epoch = generation.current
    const current = () =>
      mounted.current &&
      account.allowed.current &&
      generation.current === epoch &&
      flight.current === token &&
      (account.deadline.current === undefined || account.deadline.current > Date.now())
    flight.current = token
    setState((previous) => ({ ...previous, pending, error: null }))
    try {
      const page = await Promise.resolve().then(() => {
        if (!current()) {
          throw new Error('STALE_REQUEST')
        }
        return operation()
      })
      if (!current()) {
        return false
      }
      if (page.caseRevision < selected.current.view.revision) {
        throw new Error('REVISION_CONFLICT')
      }
      pageRef.current = page
      if (pending === 'apply') {
        request.current = null
      }
      setState({ page, pending, error: null })
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
  }
  return {
    ...state,
    ready: account.ready,
    busy: state.pending !== null,
    read: () => {
      const { view, draft } = selected.current
      const query = {
        projectId: view.binding.scope.projectRef,
        caseId: view.id,
        draftRef: draft.draftRef
      }
      return act('read', async () =>
        readWorkflowPlanApplication(
          await window.api.hiveTasks.getWorkflowPlanApplication(query),
          view,
          draft
        )
      )
    },
    apply: () => {
      const page = pageRef.current
      if (!page?.eligibility.available) {
        return Promise.resolve(false)
      }
      const { view, draft } = selected.current
      const fields = {
        projectId: view.binding.scope.projectRef,
        caseId: view.id,
        draftRef: draft.draftRef,
        expectedCaseRevision: page.caseRevision,
        expectedProjectRevision: page.currentProjectBindingRevision,
        planRevision: draft.intent.facts.planRevision,
        draftDigest: digest(draft)
      }
      const signature = digest(fields)
      const input =
        request.current?.signature === signature
          ? request.current.input
          : { ...fields, requestId: createBrowserUuid() }
      request.current = { signature, input }
      return act('apply', async () =>
        readWorkflowPlanApplyReply(
          await window.api.hiveTasks.applyWorkflowPlan(input),
          input,
          view,
          draft
        )
      )
    }
  }
}
