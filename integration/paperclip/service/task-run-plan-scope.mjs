import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  readPlanGraphSource,
  readPlanGraphRows,
  planRunAdmission,
  validatePlanRunBinding
} from './workflow-plan-graph-records.mjs'
import {
  WORKBENCH_UPSTREAM_ROLES,
  refuseWorkbench as refuse
} from './team-workbench-repository-records.mjs'
import { planGraphAvailability } from './workflow-plan-graph-policy.mjs'

export async function readPlanTaskScope(db, accountId, taskId, runId, lock, candidate) {
  const source = await readPlanGraphSource(db, accountId, {
    projectId: candidate.project_id,
    caseId: candidate.case_id,
    applicationRef: candidate.application_id
  })
  const records = await readPlanGraphRows(db, accountId, source)
  const admission = planRunAdmission(source, records, taskId, runId)
  if (lock) {
    await db`SELECT i.id FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id WHERE i.id=${taskId} AND b.run_id=${runId} AND b.account_id=${accountId} FOR UPDATE OF i,b`
  }
  const [task] =
    await db`SELECT i.*,b.account_id,b.run_id,b.binding,b.result_receipt,b.workspace_selector,
    (b.cancel_requested OR h.context_snapshot->'externalExecutionControl'->'cancel' IS NOT NULL) AS cancel_requested,
    h.company_id AS run_company_id,h.agent_id,h.execution_stage,h.driver_kind,h.status AS run_status,
    g.adapter_type,g.adapter_config,g.role AS agent_role,g.company_id AS agent_company_id
    FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id JOIN heartbeat_runs h ON h.id=b.run_id
    JOIN agents g ON g.id=h.agent_id WHERE i.id=${taskId} AND b.run_id=${runId} AND b.account_id=${accountId} FOR SHARE OF i,b,h,g`
  const employee = source.view.team.employees.find(
    (item) => item.employeeRef === admission.run.employeeRef
  )
  if (
    !task ||
    !employee ||
    task.company_id !== source.project.companyId ||
    task.project_id !== source.project.id ||
    task.parent_id !== source.view.originTaskId ||
    task.run_company_id !== task.company_id ||
    task.agent_company_id !== task.company_id ||
    task.agent_id !== employee.employeeRef ||
    task.assignee_agent_id !== employee.employeeRef ||
    task.assignee_user_id !== null ||
    task.driver_kind !== 'hive_runtime' ||
    task.adapter_type !== 'hive_runtime' ||
    task.agent_role !== WORKBENCH_UPSTREAM_ROLES[employee.role] ||
    digest(task.adapter_config) !== digest({})
  ) {
    refuse('FORBIDDEN')
  }
  const scope = {
    kind: 'workbenchPlan',
    accountId,
    companyId: task.company_id,
    projectId: source.project.id,
    caseId: source.view.id,
    graphRef: records.graph.graphRef,
    applicationRef: source.application.applicationRef,
    proposalTaskRef: admission.run.proposalTaskRef,
    stageRef: admission.run.proposalTaskRef,
    role: employee.role,
    employeeRef: employee.employeeRef,
    profileId: employee.profileRef,
    profileRevision: employee.profileRevision,
    workspaceSelector: source.project.workspaceSelector,
    workspaceRef: source.view.team.project.hiveWorkspaceRef,
    workflowId: source.view.binding.workflowRef,
    workflowRevision: source.view.binding.workflowRevision,
    definitionDigest: source.view.definitionDigest,
    projectBindingRevision: source.view.projectBindingRevision,
    teamSnapshotDigest: digest(source.view.team),
    ownerScope: source.view.team.company.ownerScope,
    ownerAccountRef: source.view.team.company.ownerAccountRef,
    ownerActorRef: source.view.team.company.ownerActorRef,
    companyBindingRevision: source.view.team.company.bindingRevision
  }
  if (task.binding) {
    validatePlanRunBinding(source, { ...admission, task: admission.run.task }, task.binding)
  }
  return { ...task, run_scope: scope }
}

export async function requirePlanRunDispatch(db, accountId, task) {
  if (task.run_scope.kind !== 'workbenchPlan') {
    return
  }
  const scope = task.run_scope,
    source = await readPlanGraphSource(db, accountId, scope),
    records = await readPlanGraphRows(db, accountId, source)
  const admission = planRunAdmission(source, records, task.id, task.run_id)
  const reason = await planGraphAvailability(db, accountId, source, records.graph)
  if (
    reason ||
    records.graph.status !== 'running' ||
    task.cancel_requested ||
    admission.run.status !== 'pending'
  ) {
    refuse('REVISION_CONFLICT')
  }
}
