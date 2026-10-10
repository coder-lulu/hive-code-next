import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { workflowTestVectors } from '../../src/shared/task-workflow/workflow.test-fixture.ts'
import { taskCommand } from '../../src/main/tasks/task-execution.test-fixture.ts'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'
import { workbenchOwnerReferences } from '../../integration/paperclip/service/team-workbench-repository-records.mjs'
import {
  workflowPipelineStages,
  workflowPipelineTransitions
} from '../../integration/paperclip/service/workflow-pipeline-definition.mjs'
import { workflowPipelineStageConfig } from '../../integration/paperclip/service/workflow-pipeline-policy.mjs'

export function runScopeFixture(personal = false) {
  const accountId = 'authenticated:run-scope-test'
  const companyId = randomUUID(),
    projectId = randomUUID(),
    caseId = randomUUID()
  const taskId = randomUUID(),
    runId = randomUUID(),
    workflowId = randomUUID()
  const owner = workbenchOwnerReferences(accountId)
  const team = structuredClone(workflowTestVectors.examples.team)
  team.company = {
    ...team.company,
    companyRef: companyId,
    ownerAccountRef: owner.accountRef,
    ownerActorRef: owner.actorRef,
    ownerScope: { kind: 'personalTenant', tenantRef: owner.accountRef }
  }
  team.project = {
    ...team.project,
    scope: { companyRef: companyId, projectRef: projectId },
    hiveWorkspaceRef: 'workspace:scope-fixture',
    bindingRevision: 2
  }
  team.employees = team.employees.map((employee) => ({
    ...employee,
    scope: team.project.scope,
    employeeRef: randomUUID(),
    bindingRevision: 2
  }))
  const employee = team.employees.find((member) => member.role === 'developer')
  const definition = {
    ...structuredClone(workflowTestVectors.examples.definition),
    scope: team.project.scope,
    workflowRef: workflowId,
    workflowRevision: 1
  }
  const stage = definition.stages.find((item) => item.role === 'developer')
  const snapshot = {
    workflowId,
    name: 'Run scope fixture',
    definition,
    definitionDigest: digest({ name: 'Run scope fixture', definition }),
    projectBindingRevision: 2
  }
  const command = taskCommand({
    profileId: 'codex',
    profileRevision: 'codex:1',
    ownerScope: team.company.ownerScope,
    workspaceRef: team.project.hiveWorkspaceRef,
    executionPolicy: {
      trustMode: personal ? 'trusted_personal_preview' : 'enforced_autonomous',
      executionPolicyRef: 'policy:scope-fixture',
      executionPolicyRevision: 'policy:1',
      ...(personal ? {} : { enforcementEvidenceRef: 'enforcement:scope-fixture' })
    },
    task: { spaceId: companyId, taskId, runId, attempt: 1, taskRevision: '0' }
  })
  const task = {
    id: taskId,
    account_id: accountId,
    company_id: companyId,
    project_id: projectId,
    parent_id: randomUUID(),
    assignee_agent_id: employee.employeeRef,
    assignee_user_id: null,
    run_id: runId,
    run_company_id: companyId,
    agent_id: employee.employeeRef,
    agent_company_id: companyId,
    agent_adapter_type: 'hive_runtime',
    agent_adapter_config: {},
    agent_role: 'engineer',
    driver_kind: 'hive_runtime',
    workspace_selector: 'folder:scope-fixture',
    run_status: 'running',
    cancel_requested: false,
    result_receipt: null,
    personal_company_id: personal ? companyId : null,
    personal_agent_id: personal ? employee.employeeRef : null,
    case_id: personal ? null : caseId,
    stage_ref: personal ? null : stage.stageRef,
    binding: {
      bindingRef: 'binding:scope-fixture',
      paperclipCompanyId: companyId,
      paperclipAgentId: employee.employeeRef,
      command,
      commandFingerprint: computeTaskExecutionFingerprint(command, 'test:scope')
    }
  }
  const caseRow = {
    case_id: caseId,
    account_id: accountId,
    company_id: companyId,
    project_id: projectId,
    workflow_id: workflowId,
    workflow_revision: 1,
    definition_digest: snapshot.definitionDigest,
    project_binding_revision: 2,
    team_snapshot_json: team,
    team_snapshot_digest: digest(team),
    origin_issue_id: task.parent_id,
    owner_account_ref: owner.accountRef,
    owner_actor_ref: owner.actorRef,
    tenant_ref: owner.accountRef,
    company_revision: team.company.bindingRevision,
    workspace_selector: task.workspace_selector,
    hive_workspace_ref: team.project.hiveWorkspaceRef,
    project_revision: 2,
    case_company_id: companyId,
    pipeline_id: randomUUID(),
    case_retired_at: null,
    origin_company_id: companyId,
    origin_project_id: projectId,
    origin_parent_id: null,
    origin_link_company_id: companyId,
    origin_link_role: 'origin',
    origin_link_retired_at: null,
    link_company_id: companyId,
    link_role: 'work',
    link_retired_at: null,
    revision_company_id: companyId,
    revision_project_id: projectId,
    revision_pipeline_id: null,
    revision_digest: snapshot.definitionDigest,
    pipeline_company_id: companyId,
    pipeline_project_id: projectId,
    pipeline_archived_at: null,
    snapshot_workflow_id: workflowId,
    snapshot_workflow_ref: workflowId,
    snapshot_revision: 1,
    snapshot_digest: snapshot.definitionDigest,
    snapshot_scope: team.project.scope,
    snapshot_definition: structuredClone(definition),
    stage_pipeline_id: null,
    stage_key: `stage_${digest(stage.stageRef)}`,
    stage_kind: 'working',
    stage_config: workflowPipelineStageConfig(definition, stage, team.employees)
  }
  caseRow.revision_pipeline_id = caseRow.pipeline_id
  caseRow.stage_pipeline_id = caseRow.pipeline_id
  const currentEmployees = structuredClone(team.employees)
  const pipelineStages = workflowPipelineStages(definition, currentEmployees).map((item) => ({
    ...item,
    id: randomUUID()
  }))
  const stageIds = new Map(pipelineStages.map((item) => [item.key, item.id]))
  const pipelineEdges = workflowPipelineTransitions(definition).map((edge) => ({
    from_stage_id: stageIds.get(edge.from),
    to_stage_id: stageIds.get(edge.to),
    label: edge.label
  }))
  const calls = []
  const sql = vi.fn(async (strings, ...values) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim()
    calls.push({ text, values })
    if (
      text ===
      'SELECT a.application_id,a.case_id,i.project_id FROM hive_task_bindings b JOIN issues i ON i.id=b.task_id JOIN hive_workflow_plan_application_tasks m ON m.issue_id=i.id JOIN hive_workflow_plan_applications a ON a.application_id=m.application_id WHERE b.account_id=? AND b.run_id=? AND i.id=?'
    ) {
      return []
    }
    if (text.startsWith('SELECT r.case_id,cb.project_id')) {
      return task.account_id === values[0] && task.id === values[1] && task.run_id === values[2]
        ? [
            {
              case_id: task.case_id,
              project_id: caseRow.project_id,
              company_id: caseRow.company_id,
              case_account_id: caseRow.account_id,
              workflow_id: caseRow.workflow_id,
              workflow_revision: caseRow.workflow_revision,
              project_binding_revision: caseRow.project_binding_revision
            }
          ]
        : []
    }
    if (text.startsWith('SELECT c.id AS company_id')) {
      return [
        {
          company_id: caseRow.company_id,
          company_name: 'Scope company',
          owner_account_ref: caseRow.owner_account_ref,
          owner_actor_ref: caseRow.owner_actor_ref,
          tenant_ref: caseRow.tenant_ref,
          company_revision: caseRow.company_revision,
          project_id: caseRow.project_id,
          project_name: 'Scope project',
          workspace_selector: caseRow.workspace_selector,
          hive_workspace_ref: caseRow.hive_workspace_ref,
          project_revision: caseRow.project_revision
        }
      ]
    }
    if (text.startsWith('SELECT h.*')) {
      return [
        {
          workflow_id: workflowId,
          latest_revision: 1,
          pipeline_company_id: companyId,
          pipeline_project_id: projectId,
          archived_at: null
        }
      ]
    }
    if (text.startsWith('SELECT r.definition_json')) {
      return [
        {
          definition_json: structuredClone(snapshot),
          definition_digest: snapshot.definitionDigest,
          revision_company_id: companyId,
          revision_project_id: projectId,
          workflow_id: workflowId,
          revision: 1,
          id: caseRow.pipeline_id,
          company_id: companyId,
          project_id: projectId,
          name: snapshot.name,
          key: `hive_${workflowId}_r1`,
          enforce_transitions: true,
          archived_at: null
        }
      ]
    }
    if (text.includes('FROM hive_workbench_employee_bindings')) {
      const upstream = { product: 'pm', developer: 'engineer', tester: 'qa', ops: 'devops' }
      return currentEmployees.map((member) => ({
        employee_id: member.employeeRef,
        role: member.role,
        company_id: companyId,
        project_id: projectId,
        upstream_role: upstream[member.role],
        adapter_type: 'hive_runtime',
        adapter_config: {},
        binding_revision: caseRow.project_revision,
        project_revision: caseRow.project_revision
      }))
    }
    if (text.includes('FROM pipeline_stages')) {
      return structuredClone(pipelineStages)
    }
    if (text.includes('FROM pipeline_transitions')) {
      return structuredClone(pipelineEdges)
    }
    if (text.startsWith('SELECT i.id FROM issues')) {
      return task.id === values[1] ? [{ id: task.id }] : []
    }
    if (text.startsWith('SELECT b.account_id,b.task_id')) {
      return task.company_id === values[0] && task.run_id === values[1]
        ? [{ account_id: task.account_id, task_id: task.id }]
        : []
    }
    if (text.startsWith('SELECT i.*,b.account_id')) {
      return task.account_id === values[0] && task.id === values[1] && task.run_id === values[2]
        ? [structuredClone(task)]
        : []
    }
    if (text.startsWith('SELECT cb.case_id')) {
      return caseRow.missing ? [] : [structuredClone(caseRow)]
    }
    if (text.startsWith('SELECT id,company_id,adapter_type')) {
      return [
        {
          id: task.agent_id,
          company_id: task.agent_company_id,
          adapter_type: task.agent_adapter_type,
          adapter_config: task.agent_adapter_config,
          role: task.agent_role
        }
      ]
    }
    throw new Error(`Unexpected scope SQL: ${text}`)
  })
  const refreshTeamDigest = () => {
    caseRow.team_snapshot_digest = digest(caseRow.team_snapshot_json)
  }
  return {
    sql,
    calls,
    accountId,
    companyId,
    projectId,
    caseId,
    taskId,
    runId,
    task,
    caseRow,
    snapshot,
    team,
    stage,
    employee,
    currentEmployees,
    refreshTeamDigest
  }
}
