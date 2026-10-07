import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { WorkflowTeamBindingSchema } from '../../../src/shared/task-workflow/workflow-bindings.ts'
import {
  WorkflowDefinitionSchema,
  WorkflowStageSchema
} from '../../../src/shared/task-workflow/workflow-definition.ts'
import {
  TaskDigest,
  TaskEpoch
} from '../../../src/shared/task-execution/task-execution-primitives.ts'
import { refuseTaskRepository as refuse } from './task-delivery-repository.mjs'
import { workbenchOwnerReferences } from './team-workbench-repository-records.mjs'
import {
  workflowPipelineStageConfig,
  assertCurrentWorkflowEmployees
} from './workflow-pipeline-policy.mjs'

function requireMatching(condition, code = 'REVISION_CONFLICT') {
  if (!condition) {
    refuse(code)
  }
}

function stored(schema, value) {
  const parsed = schema.safeParse(value)
  requireMatching(parsed.success)
  return parsed.data
}
export async function validateWorkflowTaskCase(db, task, row, accountId) {
  const owner = workbenchOwnerReferences(accountId)
  requireMatching(
    row.owner_account_ref === owner.accountRef &&
      row.owner_actor_ref === owner.actorRef &&
      row.tenant_ref === owner.accountRef,
    'FORBIDDEN'
  )
  const team = stored(WorkflowTeamBindingSchema, row.team_snapshot_json)
  const revision = stored(TaskEpoch, Number(row.project_binding_revision))
  stored(TaskEpoch, Number(row.workflow_revision))
  stored(TaskDigest, row.definition_digest)
  const definition = stored(WorkflowDefinitionSchema, row.snapshot_definition)
  const stages = definition.stages.filter((stage) => stage.stageRef === task.stage_ref)
  const stage = stored(WorkflowStageSchema, stages[0])
  requireMatching(
    stages.length === 1 &&
      stage.stageRef === task.stage_ref &&
      row.snapshot_workflow_id === row.workflow_id &&
      row.snapshot_workflow_ref === row.workflow_id &&
      Number(row.snapshot_revision) === Number(row.workflow_revision) &&
      row.snapshot_digest === row.definition_digest &&
      row.snapshot_scope?.companyRef === task.company_id &&
      row.snapshot_scope?.projectRef === task.project_id &&
      row.stage_key === `stage_${digest(task.stage_ref)}` &&
      row.stage_pipeline_id === row.pipeline_id &&
      row.stage_kind === (stage.role === 'tester' ? 'review' : 'working') &&
      digest(row.stage_config) ===
        digest(workflowPipelineStageConfig(definition, stage, team.employees))
  )
  requireMatching(
    row.case_id === task.case_id &&
      row.account_id === accountId &&
      row.company_id === task.company_id &&
      row.project_id === task.project_id &&
      row.case_company_id === task.company_id &&
      row.case_retired_at === null &&
      row.origin_issue_id === task.parent_id &&
      row.origin_company_id === task.company_id &&
      row.origin_project_id === task.project_id &&
      row.origin_parent_id === null &&
      row.origin_link_company_id === task.company_id &&
      row.origin_link_role === 'origin' &&
      row.origin_link_retired_at === null &&
      row.link_company_id === task.company_id &&
      row.link_role === 'work' &&
      row.link_retired_at === null &&
      row.revision_company_id === task.company_id &&
      row.revision_project_id === task.project_id &&
      row.revision_pipeline_id === row.pipeline_id &&
      row.revision_digest === row.definition_digest &&
      row.pipeline_company_id === task.company_id &&
      row.pipeline_project_id === task.project_id &&
      row.pipeline_archived_at === null &&
      row.workspace_selector === task.workspace_selector &&
      Number(row.project_revision) >= revision &&
      digest(team) === row.team_snapshot_digest &&
      team.company.companyRef === task.company_id &&
      team.company.ownerAccountRef === owner.accountRef &&
      team.company.ownerActorRef === owner.actorRef &&
      team.company.ownerScope.kind === 'personalTenant' &&
      team.company.ownerScope.tenantRef === owner.accountRef &&
      team.company.bindingRevision === Number(row.company_revision) &&
      team.project.scope.companyRef === task.company_id &&
      team.project.scope.projectRef === task.project_id &&
      team.project.hiveWorkspaceRef === row.hive_workspace_ref &&
      team.project.bindingRevision === revision &&
      team.employees.every(
        (employee) =>
          employee.bindingRevision === revision &&
          employee.profileRef === 'codex' &&
          employee.profileRevision === 'codex:1'
      )
  )
  await assertCurrentWorkflowEmployees(db, definition.scope, team.employees)
  return { team, stage }
}
