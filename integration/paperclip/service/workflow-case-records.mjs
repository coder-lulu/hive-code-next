import {
  HiveWorkflowCaseSummarySchema,
  HiveWorkflowCaseViewSchema
} from '../../../src/shared/hive-workflow-cases.ts'
import { WorkflowTeamBindingSchema } from '../../../src/shared/task-workflow/workflow-bindings.ts'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { readWorkflowDefinitionRevision } from './workflow-definition-repository.mjs'
import { refuseWorkbench, workbenchOwnerReferences } from './team-workbench-repository-records.mjs'
import { readWorkflowCaseEvidence } from './workflow-case-evidence-projection.mjs'

function stored(schema, value) {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  return parsed.data
}

export function workflowCaseAdmissionFingerprint(view) {
  return digest({
    binding: view.binding,
    definitionDigest: view.definitionDigest,
    projectBindingRevision: view.projectBindingRevision,
    workflow: view.workflow,
    team: view.team,
    originTaskId: view.originTaskId,
    stageTasks: view.stageTasks
      .map(({ stageRef, taskId, employeeRef, role }) => ({
        stageRef,
        taskId,
        employeeRef,
        role
      }))
      .toSorted((a, b) => a.stageRef.localeCompare(b.stageRef))
  })
}

async function readCaseRecord(db, accountId, project, caseId, revisions) {
  const [binding] = await db`SELECT workflow_id,workflow_revision,project_binding_revision
    FROM hive_workflow_case_bindings WHERE case_id=${caseId} AND account_id=${accountId}
      AND company_id=${project.companyId} AND project_id=${project.id}`
  if (!binding) {
    return refuseWorkbench('FORBIDDEN')
  }
  // The authorized immutable binding selects the revision before any Case or stage row locks.
  const key = `${binding.workflow_id}:${binding.workflow_revision}:${binding.project_binding_revision}`
  let revision = revisions?.get(key)
  if (!revision) {
    revision = await readWorkflowDefinitionRevision(
      db,
      project,
      binding.workflow_id,
      Number(binding.workflow_revision),
      Number(binding.project_binding_revision)
    )
    revisions?.set(key, revision)
  }
  const [row] = await db`SELECT c.*,b.account_id,b.company_id AS binding_company_id,
    b.project_id,b.workflow_id,b.workflow_revision,b.definition_digest,b.project_binding_revision,
    b.team_snapshot_json,b.team_snapshot_digest,b.origin_issue_id,
    s.pipeline_id AS stage_pipeline_id,s.key AS stage_key,s.kind AS stage_kind,s.config AS stage_config
    FROM hive_workflow_case_bindings b JOIN pipeline_cases c ON c.id=b.case_id
    JOIN pipeline_stages s ON s.id=c.stage_id
    WHERE b.case_id=${caseId} AND b.account_id=${accountId}
      AND b.company_id=${project.companyId} AND b.project_id=${project.id}
    FOR SHARE OF b,c,s`
  if (!row) {
    return refuseWorkbench('FORBIDDEN')
  }
  const team = stored(WorkflowTeamBindingSchema, row.team_snapshot_json)
  const owner = workbenchOwnerReferences(accountId)
  if (
    row.workflow_id !== binding.workflow_id ||
    Number(row.workflow_revision) !== Number(binding.workflow_revision) ||
    Number(row.project_binding_revision) !== Number(binding.project_binding_revision) ||
    row.company_id !== project.companyId ||
    row.stage_pipeline_id !== row.pipeline_id ||
    row.retired_at !== null ||
    digest(team) !== row.team_snapshot_digest ||
    team.company.companyRef !== project.companyId ||
    team.project.scope.projectRef !== project.id ||
    team.company.ownerAccountRef !== owner.accountRef ||
    team.company.ownerActorRef !== owner.actorRef ||
    team.company.ownerScope.kind !== 'personalTenant' ||
    team.company.ownerScope.tenantRef !== owner.accountRef ||
    team.project.bindingRevision !== Number(row.project_binding_revision)
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  const workflow = revision.snapshot
  if (
    row.pipeline_id !== revision.pipelineId ||
    row.definition_digest !== workflow.definitionDigest
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  const stageRef = row.stage_config.hiveWorkflow?.stage?.stageRef
  if (
    row.terminal_kind === null
      ? !workflow.definition.stages.some((stage) => stage.stageRef === stageRef) ||
        ['done', 'cancelled'].includes(row.stage_kind)
      : row.stage_kind !== row.terminal_kind || row.stage_key !== row.terminal_kind
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  const summary = stored(HiveWorkflowCaseSummarySchema, {
    id: row.id,
    title: row.title,
    binding: {
      scope: project.binding.scope,
      workflowRef: row.workflow_id,
      workflowRevision: Number(row.workflow_revision),
      workflowRunRef: row.id
    },
    definitionDigest: row.definition_digest,
    projectBindingRevision: Number(row.project_binding_revision),
    revision: row.version,
    currentStageRef: row.terminal_kind === null ? stageRef : null,
    terminalKind: row.terminal_kind,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  })
  return { row, summary, workflow, team }
}

export async function readWorkflowCaseSummary(db, accountId, project, caseId, revisions) {
  return (await readCaseRecord(db, accountId, project, caseId, revisions)).summary
}

export async function readWorkflowCaseView(db, accountId, project, caseId, expectedRequestId) {
  const { row, summary, workflow, team } = await readCaseRecord(db, accountId, project, caseId)
  if (expectedRequestId !== undefined && row.case_key !== expectedRequestId) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  const [origin] =
    await db`SELECT i.*,l.company_id AS link_company_id,l.role AS link_role,l.retired_at AS link_retired_at
    FROM issues i JOIN pipeline_case_issue_links l ON l.issue_id=i.id AND l.case_id=${caseId}
    WHERE i.id=${row.origin_issue_id} FOR SHARE OF i,l`
  if (
    !origin ||
    origin.company_id !== project.companyId ||
    origin.project_id !== project.id ||
    origin.parent_id !== null ||
    origin.link_company_id !== project.companyId ||
    origin.link_role !== 'origin' ||
    origin.link_retired_at !== null
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  const tasks = await db`SELECT r.stage_ref,i.id,i.company_id,i.project_id,i.parent_id,
    i.assignee_agent_id,i.assignee_user_id,i.status,i.status_version,
    l.company_id AS link_company_id,l.role AS link_role,l.retired_at AS link_retired_at
    FROM hive_workflow_case_stage_issues r JOIN issues i ON i.id=r.issue_id
    JOIN pipeline_case_issue_links l ON l.issue_id=i.id AND l.case_id=r.case_id
    WHERE r.case_id=${caseId} ORDER BY r.stage_ref LIMIT 33 FOR SHARE OF r,i,l`
  if (
    tasks.length !== workflow.definition.stages.length ||
    tasks.some(
      (task) =>
        task.company_id !== project.companyId ||
        task.project_id !== project.id ||
        task.parent_id !== origin.id ||
        task.assignee_user_id !== null ||
        task.link_company_id !== project.companyId ||
        task.link_role !== 'work' ||
        task.link_retired_at !== null
    )
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  const byStage = new Map(tasks.map((task) => [task.stage_ref, task]))
  const view = {
    ...summary,
    requirement: origin.description,
    originTaskId: origin.id,
    workflow,
    team,
    stageTasks: workflow.definition.stages.map((stage) => {
      const task = byStage.get(stage.stageRef)
      return {
        stageRef: stage.stageRef,
        taskId: task?.id,
        employeeRef: task?.assignee_agent_id,
        role: stage.role,
        taskRevision: Number(task?.status_version),
        status: task?.status
      }
    }),
    executionAvailability: { available: false, reason: 'EXECUTION_ISOLATION_UNAVAILABLE' }
  }
  return stored(HiveWorkflowCaseViewSchema, {
    ...view,
    ...(await readWorkflowCaseEvidence(db, accountId, view))
  })
}
