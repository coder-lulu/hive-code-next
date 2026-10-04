import type { Dispatch, SetStateAction } from 'react'
import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import { HiveWorkflowSaveSchema } from '../../../../../shared/hive-task-workflows'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  createWorkflowDraft,
  workflowDraftFromSnapshot,
  workflowDraftInput,
  workflowDraftRefusal,
  type HiveWorkflowDraft
} from './hive-workflow-draft'
import {
  assertSavedWorkflow,
  mergeWorkflowSnapshots,
  readWorkflowSnapshot
} from './hive-workflow-responses'
import type { HiveWorkflowAct, HiveWorkflowState } from './hive-workflow-editor-state'

export function createHiveWorkflowMutations({
  team,
  state,
  dirty,
  historical,
  mounted,
  flight,
  request,
  act,
  setState
}: {
  team: HiveWorkbenchTeam
  state: HiveWorkflowState
  dirty: boolean
  historical: boolean
  mounted: { current: boolean }
  flight: { current: object | null }
  request: { current: { signature: string; id: string } | null }
  act: HiveWorkflowAct
  setState: Dispatch<SetStateAction<HiveWorkflowState>>
}) {
  return {
    create: (copy: (key: string) => string) => {
      if (!mounted.current || flight.current || dirty) {
        return
      }
      request.current = null
      setState((previous) => ({
        ...previous,
        baseline: null,
        incoming: null,
        draft: createWorkflowDraft(copy),
        error: null
      }))
    },
    discard: () => {
      if (!mounted.current || flight.current) {
        return
      }
      request.current = null
      setState((previous) => ({
        ...previous,
        incoming: null,
        draft: previous.baseline ? workflowDraftFromSnapshot(previous.baseline) : null,
        error: null
      }))
    },
    edit: (change: (draft: HiveWorkflowDraft) => HiveWorkflowDraft) => {
      if (!mounted.current || flight.current || historical) {
        return
      }
      setState((previous) => ({
        ...previous,
        draft: previous.draft ? change(previous.draft) : null,
        error: null
      }))
    },
    reviewLatest: () => {
      const workflowId = state.draft?.workflowId
      if (!workflowId || !dirty || !state.baseline) {
        return Promise.resolve(false)
      }
      const baselineRevision = state.baseline.definition.workflowRevision
      return act(
        'read',
        async () => {
          const snapshot = readWorkflowSnapshot(
            await window.api.hiveTasks.getWorkflow({ projectId: team.project.id, workflowId }),
            team
          )
          if (
            snapshot.workflowId !== workflowId ||
            snapshot.definition.workflowRevision < baselineRevision
          ) {
            throw new Error('INVALID_RESPONSE')
          }
          return snapshot
        },
        (incoming) =>
          setState((previous) => ({
            ...previous,
            incoming,
            items: mergeWorkflowSnapshots(previous.items, [incoming])
          }))
      )
    },
    adoptReviewedBase: () => {
      if (
        !mounted.current ||
        flight.current ||
        !state.incoming ||
        state.draft?.workflowId !== state.incoming.workflowId
      ) {
        return
      }
      request.current = null
      const incoming = state.incoming
      setState((previous) => ({
        ...previous,
        baseline: incoming,
        incoming: null,
        draft: previous.draft
          ? { ...previous.draft, expectedRevision: incoming.definition.workflowRevision }
          : null,
        error: null
      }))
    },
    save: async () => {
      if (
        !state.draft ||
        !dirty ||
        historical ||
        state.incoming ||
        !mounted.current ||
        flight.current
      ) {
        return false
      }
      const refusal = workflowDraftRefusal(state.draft, team)
      if (refusal) {
        setState((previous) => ({ ...previous, error: refusal }))
        return false
      }
      const input = workflowDraftInput(state.draft, team)
      const signature = JSON.stringify(input)
      const id = request.current?.signature === signature ? request.current.id : createBrowserUuid()
      request.current = { signature, id }
      const payload = HiveWorkflowSaveSchema.parse({ ...input, requestId: id })
      return act(
        'save',
        async () => {
          const snapshot = readWorkflowSnapshot(
            await window.api.hiveTasks.saveWorkflow(payload),
            team
          )
          assertSavedWorkflow(snapshot, payload)
          return snapshot
        },
        (snapshot) => {
          request.current = null
          setState((previous) => ({
            ...previous,
            incoming: null,
            items: mergeWorkflowSnapshots(previous.items, [snapshot]),
            baseline: snapshot,
            draft: workflowDraftFromSnapshot(snapshot)
          }))
        }
      )
    }
  }
}
