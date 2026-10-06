import { WorkflowTeamBindingSchema } from '../../../src/shared/task-workflow/workflow-bindings.ts'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  refuseWorkbench as refuse,
  workbenchOwnerReferences
} from './team-workbench-repository-records.mjs'
import { readWorkflowProjectEmployees } from './workflow-pipeline-policy.mjs'
import {
  workflowPipelineStages,
  workflowPipelineTransitions
} from './workflow-pipeline-definition.mjs'

/** The caller owns the authorized project SHARE and revision pipeline UPDATE locks. */
export async function repairWorkflowPipelineReview(db, snapshot, pipeline, authorizedProject) {
  const { definition } = snapshot
  if (
    pipeline.company_id !== authorizedProject.companyId ||
    pipeline.project_id !== authorizedProject.id ||
    definition.scope.companyRef !== authorizedProject.companyId ||
    definition.scope.projectRef !== authorizedProject.id ||
    snapshot.definitionDigest !== digest({ name: snapshot.name, definition })
  ) {
    refuse('REVISION_CONFLICT')
  }
  const employees = await readWorkflowProjectEmployees(db, definition.scope)
  const expected = workflowPipelineStages(definition, employees)
  const stages = await db`SELECT id,key,name,kind,position,config FROM pipeline_stages
    WHERE pipeline_id=${pipeline.id} ORDER BY position,key FOR SHARE`
  const rows = stages.map(({ id: _id, ...stage }) => stage)
  if (digest(rows) === digest(expected)) {
    return
  }
  const original = expected.map((stage) => ({
    ...stage,
    config: { hiveWorkflow: stage.config.hiveWorkflow }
  }))
  if (digest(rows) !== digest(original)) {
    refuse('REVISION_CONFLICT')
  }
  const keys = new Map(stages.map((stage) => [stage.id, stage.key]))
  const edges = await db`SELECT from_stage_id,to_stage_id,label FROM pipeline_transitions
    WHERE pipeline_id=${pipeline.id} FOR SHARE`
  const sort = (value) =>
    value.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const actual = edges.map((edge) => ({
    from: keys.get(edge.from_stage_id),
    to: keys.get(edge.to_stage_id),
    label: edge.label
  }))
  if (digest(sort(actual)) !== digest(sort(workflowPipelineTransitions(definition)))) {
    refuse('REVISION_CONFLICT')
  }
  const [owner] = await db`SELECT account_id,owner_account_ref,owner_actor_ref,tenant_ref
    FROM hive_workbench_company_bindings WHERE company_id=${authorizedProject.companyId} FOR SHARE`
  const refs = owner && workbenchOwnerReferences(owner.account_id)
  if (
    !owner ||
    owner.owner_account_ref !== refs.accountRef ||
    owner.owner_actor_ref !== refs.actorRef ||
    owner.tenant_ref !== refs.accountRef
  ) {
    refuse('FORBIDDEN')
  }
  const nativeCases =
    await db`SELECT id FROM pipeline_cases WHERE pipeline_id=${pipeline.id} FOR SHARE`
  const cases =
    await db`SELECT c.id,c.company_id,b.account_id,b.company_id AS binding_company_id,b.project_id,
    b.workflow_id,b.workflow_revision,b.definition_digest,b.project_binding_revision,b.team_snapshot_json,b.team_snapshot_digest
    FROM pipeline_cases c JOIN hive_workflow_case_bindings b ON b.case_id=c.id
    WHERE c.pipeline_id=${pipeline.id} FOR SHARE OF c,b`
  if (nativeCases.length !== cases.length) {
    refuse('REVISION_CONFLICT')
  }
  for (const row of cases) {
    const parsed = WorkflowTeamBindingSchema.safeParse(row.team_snapshot_json)
    if (!parsed.success) {
      refuse('REVISION_CONFLICT')
    }
    const team = parsed.data
    if (
      row.account_id !== owner.account_id ||
      row.company_id !== authorizedProject.companyId ||
      row.binding_company_id !== authorizedProject.companyId ||
      row.project_id !== authorizedProject.id ||
      row.workflow_id !== snapshot.workflowId ||
      Number(row.workflow_revision) !== definition.workflowRevision ||
      row.definition_digest !== snapshot.definitionDigest ||
      digest(team) !== row.team_snapshot_digest ||
      team.company.ownerAccountRef !== refs.accountRef ||
      team.company.ownerActorRef !== refs.actorRef ||
      team.company.ownerScope.kind !== 'personalTenant' ||
      team.company.ownerScope.tenantRef !== refs.accountRef ||
      team.company.companyRef !== authorizedProject.companyId ||
      team.project.scope.projectRef !== authorizedProject.id ||
      team.project.bindingRevision !== Number(row.project_binding_revision) ||
      team.employees.some(
        (employee) =>
          employee.bindingRevision !== Number(row.project_binding_revision) ||
          employees.find((current) => current.role === employee.role)?.employeeRef !==
            employee.employeeRef
      )
    ) {
      refuse('REVISION_CONFLICT')
    }
  }
  const review = stages.find((stage) => stage.kind === 'review')
  const canonical = expected.find((stage) => stage.kind === 'review').config
  const changed = await db`UPDATE pipeline_stages SET config=${db.json(canonical)}
    WHERE id=${review.id} AND pipeline_id=${pipeline.id} AND kind='review'
      AND config=${db.json(review.config)}::jsonb RETURNING id`
  if (changed.length !== 1) {
    refuse('REVISION_CONFLICT')
  }
  const details = {
    kind: 'hive.workflow.review_policy_repaired',
    workflowId: snapshot.workflowId,
    workflowRevision: definition.workflowRevision,
    definitionDigest: snapshot.definitionDigest,
    pipelineId: pipeline.id,
    stageId: review.id,
    approver: canonical.approver
  }
  for (const row of cases) {
    await db`INSERT INTO pipeline_case_events(company_id,case_id,type,actor_type,actor_user_id,payload)
      VALUES(${authorizedProject.companyId},${row.id},'updated','user',${refs.actorRef},${db.json(details)})`
  }
  await db`INSERT INTO activity_log(company_id,actor_type,actor_id,action,entity_type,entity_id,responsible_user_id,details)
    VALUES(${authorizedProject.companyId},'user',${refs.actorRef},'hive.workflow.review_policy_repaired','pipeline',${pipeline.id},
      ${refs.actorRef},${db.json(details)})`
}
