import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { workflowTestVectors } from '../../shared/task-workflow/workflow.test-fixture'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { workbenchOwnerReferences } from '../../../integration/paperclip/service/team-workbench-repository-records.mjs'
import { workflowStageKey } from '../../../integration/paperclip/service/workflow-pipeline-policy.mjs'

export function pipelinePolicyFixture() {
  const definition = structuredClone(workflowTestVectors.examples.definition)
  definition.scope = { companyRef: randomUUID(), projectRef: randomUUID() }
  definition.workflowRef = randomUUID()
  const employees = workflowTestVectors.examples.team.employees.map((employee) => ({
    ...employee,
    scope: definition.scope,
    employeeRef: randomUUID()
  }))
  const snapshot = {
    workflowId: definition.workflowRef,
    name: 'Pipeline policy fixture',
    definition,
    definitionDigest: digest({ name: 'Pipeline policy fixture', definition }),
    projectBindingRevision: 1
  }
  const stageSchema = z.strictObject({
    id: z.string().uuid(),
    key: z.string(),
    name: z.string(),
    kind: z.string(),
    position: z.number().int(),
    config: z.record(z.string(), z.unknown())
  })
  const stages: z.infer<typeof stageSchema>[] = []
  const edges: { from_stage_id: string; to_stage_id: string; label: string }[] = []
  const queries: string[] = []
  const db = Object.assign(
    async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const query = parts.join('?')
      queries.push(query)
      if (query.includes('INSERT INTO pipeline_stages')) {
        const [id, , key, name, kind, position, config] = values
        stages.push(stageSchema.parse({ id, key, name, kind, position, config }))
      } else if (query.includes('INSERT INTO pipeline_transitions')) {
        const [, from, to, label] = values
        edges.push({ from_stage_id: String(from), to_stage_id: String(to), label: String(label) })
      } else if (query.includes('FROM pipeline_stages')) {
        return stages
      } else if (query.includes('FROM pipeline_transitions')) {
        return edges
      } else if (query.includes('FROM hive_workbench_employee_bindings')) {
        const upstream = { product: 'pm', developer: 'engineer', tester: 'qa', ops: 'devops' }
        return employees.map((employee) => ({
          role: employee.role,
          employee_id: employee.employeeRef,
          company_id: definition.scope.companyRef,
          project_id: definition.scope.projectRef,
          upstream_role: upstream[employee.role],
          adapter_type: 'hive_runtime',
          adapter_config: {},
          binding_revision: 1,
          project_revision: 1
        }))
      }
      return []
    },
    { json: (value: unknown) => value }
  )
  const pipeline = {
    id: randomUUID(),
    company_id: definition.scope.companyRef,
    project_id: definition.scope.projectRef,
    name: snapshot.name,
    key: `hive_${snapshot.workflowId}_r1`,
    enforce_transitions: true,
    archived_at: null
  }
  return { definition, employees, snapshot, pipeline, db, stages, edges, queries }
}

export function pipelineCaseScopeFixture(f: ReturnType<typeof pipelinePolicyFixture>) {
  const accountId = 'pipeline-policy:owner'
  const owner = workbenchOwnerReferences(accountId)
  const scope = f.definition.scope
  const team = structuredClone(workflowTestVectors.examples.team)
  team.company = {
    ...team.company,
    companyRef: scope.companyRef,
    ownerAccountRef: owner.accountRef,
    ownerActorRef: owner.actorRef,
    ownerScope: { kind: 'personalTenant', tenantRef: owner.accountRef }
  }
  team.project.scope = scope
  team.employees = structuredClone(f.employees)
  const stage = f.definition.stages.find((stage) => stage.role === 'tester')!
  const task = {
    case_id: randomUUID(),
    company_id: scope.companyRef,
    project_id: scope.projectRef,
    parent_id: randomUUID(),
    stage_ref: stage.stageRef,
    workspace_selector: 'folder:policy'
  }
  const row = {
    owner_account_ref: owner.accountRef,
    owner_actor_ref: owner.actorRef,
    tenant_ref: owner.accountRef,
    team_snapshot_json: team,
    team_snapshot_digest: digest(team),
    project_binding_revision: 1,
    workflow_revision: 1,
    definition_digest: f.snapshot.definitionDigest,
    snapshot_definition: f.definition,
    snapshot_workflow_id: f.snapshot.workflowId,
    snapshot_workflow_ref: f.snapshot.workflowId,
    workflow_id: f.snapshot.workflowId,
    snapshot_revision: 1,
    snapshot_digest: f.snapshot.definitionDigest,
    snapshot_scope: scope,
    stage_key: workflowStageKey(stage.stageRef),
    stage_pipeline_id: f.pipeline.id,
    pipeline_id: f.pipeline.id,
    stage_kind: 'review',
    stage_config: structuredClone(f.stages.find((stage) => stage.kind === 'review')!.config),
    case_id: task.case_id,
    account_id: accountId,
    company_id: scope.companyRef,
    project_id: scope.projectRef,
    case_company_id: scope.companyRef,
    case_retired_at: null,
    origin_issue_id: task.parent_id,
    origin_company_id: scope.companyRef,
    origin_project_id: scope.projectRef,
    origin_parent_id: null,
    origin_link_company_id: scope.companyRef,
    origin_link_role: 'origin',
    origin_link_retired_at: null,
    link_company_id: scope.companyRef,
    link_role: 'work',
    link_retired_at: null,
    revision_company_id: scope.companyRef,
    revision_project_id: scope.projectRef,
    revision_pipeline_id: f.pipeline.id,
    revision_digest: f.snapshot.definitionDigest,
    pipeline_company_id: scope.companyRef,
    pipeline_project_id: scope.projectRef,
    pipeline_archived_at: null,
    workspace_selector: task.workspace_selector,
    project_revision: 1,
    company_revision: 1,
    hive_workspace_ref: team.project.hiveWorkspaceRef
  }
  return { accountId, task, row, team, stage }
}
