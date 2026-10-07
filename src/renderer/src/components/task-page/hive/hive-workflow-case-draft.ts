import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import {
  HiveWorkflowSnapshotSchema,
  type HiveWorkflowSnapshot
} from '../../../../../shared/hive-task-workflows'
import {
  HIVE_WORKFLOW_CASE_MAX_REQUEST_BYTES,
  HiveWorkflowCaseCreateSchema,
  type HiveWorkflowCaseCreate
} from '../../../../../shared/hive-workflow-cases'
import { createBrowserUuid } from '@/lib/browser-uuid'

export type HiveWorkflowCaseDraft = { requestId: string; title: string; requirement: string }
export const createWorkflowCaseDraft = (): HiveWorkflowCaseDraft => ({
  requestId: createBrowserUuid(),
  title: '',
  requirement: ''
})
export function workflowCaseInput(
  draft: HiveWorkflowCaseDraft,
  team: HiveWorkbenchTeam,
  workflow: HiveWorkflowSnapshot
): HiveWorkflowCaseCreate {
  return {
    requestId: draft.requestId,
    projectId: team.project.id,
    workflowId: workflow.workflowId,
    workflowRevision: workflow.definition.workflowRevision,
    definitionDigest: workflow.definitionDigest,
    expectedProjectRevision: team.project.binding.bindingRevision,
    title: draft.title.trim(),
    requirement: draft.requirement.trim()
  }
}
export function workflowCaseDraftRefusal(
  draft: HiveWorkflowCaseDraft,
  team: HiveWorkbenchTeam,
  workflow: HiveWorkflowSnapshot
): string | null {
  const snapshot = HiveWorkflowSnapshotSchema.safeParse(workflow)
  if (!snapshot.success) {
    return 'INVALID_REQUEST'
  }
  if (
    workflow.definition.scope.companyRef !== team.company.id ||
    workflow.definition.scope.projectRef !== team.project.id ||
    workflow.projectBindingRevision !== team.project.binding.bindingRevision
  ) {
    return 'REVISION_CONFLICT'
  }
  const input = HiveWorkflowCaseCreateSchema.safeParse(workflowCaseInput(draft, team, workflow))
  if (!input.success) {
    return 'INVALID_REQUEST'
  }
  return new TextEncoder().encode(JSON.stringify(input.data)).byteLength >
    HIVE_WORKFLOW_CASE_MAX_REQUEST_BYTES
    ? 'REQUEST_TOO_LARGE'
    : null
}
