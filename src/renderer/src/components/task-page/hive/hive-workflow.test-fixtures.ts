import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import {
  HiveWorkflowSnapshotSchema,
  type HiveWorkflowSave,
  type HiveWorkflowSnapshot
} from '../../../../../shared/hive-task-workflows'
import { WorkflowDefinitionSchema } from '../../../../../shared/task-workflow/workflow-definition'
import { structuredAgentSessionDigest } from '../../../../../shared/structured-agent-session-mutation'
import { createWorkflowDraft } from './hive-workflow-draft'
import { workbenchId } from './hive-workbench.test-fixtures'

export function workflowSnapshot(
  team: HiveWorkbenchTeam,
  revision = 1,
  value = 100,
  name = 'Private delivery'
): HiveWorkflowSnapshot {
  const draft = createWorkflowDraft((key) => key)
  return savedWorkflow(
    {
      requestId: workbenchId(99),
      projectId: team.project.id,
      workflowId: workbenchId(value),
      expectedRevision: revision - 1,
      expectedProjectRevision: team.project.binding.bindingRevision,
      name,
      stages: draft.stages,
      maxParallelism: draft.maxParallelism,
      maxDurationMs: draft.maxDurationMs
    },
    team
  )
}
export function savedWorkflow(
  input: HiveWorkflowSave,
  team: HiveWorkbenchTeam
): HiveWorkflowSnapshot {
  const workflowId = input.workflowId ?? workbenchId(100)
  const definition = WorkflowDefinitionSchema.parse({
    contractVersion: 1,
    kind: 'workflow.definition',
    scope: team.project.binding.scope,
    workflowRef: workflowId,
    workflowRevision: input.expectedRevision + 1,
    stages: input.stages,
    maxParallelism: input.maxParallelism,
    maxDurationMs: input.maxDurationMs
  })
  return HiveWorkflowSnapshotSchema.parse({
    workflowId,
    name: input.name,
    definition,
    definitionDigest: structuredAgentSessionDigest({ name: input.name, definition }),
    projectBindingRevision: team.project.binding.bindingRevision
  })
}
