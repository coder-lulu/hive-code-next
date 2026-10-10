import { randomUUID } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { WorkflowPlanIntentSchema } from '../../../src/shared/task-workflow/workflow-plan-intent.ts'
import { WORKFLOW_PLAN_LIMITS } from '../../../src/shared/task-workflow/workflow-plan-proposal.ts'
import { refuseWorkbench as refuse } from './team-workbench-repository-records.mjs'

function policy(view) {
  return {
    maxTasks: WORKFLOW_PLAN_LIMITS.tasks,
    maxAttempts: 3,
    maxParallelism: view.workflow.definition.maxParallelism,
    maxDurationMs: view.workflow.definition.maxDurationMs
  }
}

/** The caller holds the original Case row lock and admission guards in this transaction. */
export async function prepareWorkflowPlanIntent(db, view, sourceTask, stageRef) {
  const stage = view.stageTasks.find((item) => item.stageRef === stageRef)
  if (stage?.role !== 'product') {
    return null
  }
  if (typeof db.begin === 'function' || sourceTask.taskId !== stage.taskId) {
    refuse('REVISION_CONFLICT')
  }
  const [last] = await db`SELECT max(plan_revision) AS revision FROM hive_workflow_plan_intents
    WHERE case_id=${view.id}`
  const intent = WorkflowPlanIntentSchema.parse({
    contractVersion: 1,
    kind: 'workflow.plan-intent',
    intentRef: randomUUID(),
    sourceTask,
    stageRef,
    employeeRef: stage.employeeRef,
    policyRef: 'workflow.plan-inspection',
    policyRevision: 1,
    facts: {
      binding: view.binding,
      definitionDigest: view.definitionDigest,
      goalRef: view.originTaskId,
      planRevision: Number(last.revision ?? 0) + 1,
      authorizedRoles: view.team.employees.map((employee) => employee.role),
      limits: policy(view)
    }
  })
  return intent
}

export async function insertWorkflowPlanIntent(db, accountId, view, intent) {
  if (!intent) {
    return
  }
  const sourceTask = intent.sourceTask
  await db`INSERT INTO hive_workflow_plan_intents
    (run_id,intent_ref,case_id,company_id,account_id,task_id,stage_ref,plan_revision,intent_json,intent_digest)
    VALUES(${sourceTask.runId},${intent.intentRef},${view.id},${view.binding.scope.companyRef},${accountId},
      ${sourceTask.taskId},${intent.stageRef},${intent.facts.planRevision},${db.json(intent)},${digest(intent)})`
}

export function validateWorkflowPlanIntentRow(row, accountId, input, view) {
  const contextIntent = input.workflowContext?.planIntent
  if (!row) {
    if (contextIntent) {
      refuse('REVISION_CONFLICT')
    }
    return null
  }
  const parsed = WorkflowPlanIntentSchema.safeParse(row.intent_json)
  if (!parsed.success) {
    refuse('REVISION_CONFLICT')
  }
  const intent = parsed.data
  if (
    row.account_id !== accountId ||
    row.case_id !== input.caseId ||
    row.company_id !== input.task.spaceId ||
    row.task_id !== input.task.taskId ||
    row.run_id !== input.task.runId ||
    row.stage_ref !== input.stageRef ||
    row.intent_ref !== intent.intentRef ||
    Number(row.plan_revision) !== intent.facts.planRevision ||
    row.origin_task_id !== intent.facts.goalRef ||
    row.run_company_id !== intent.sourceTask.spaceId ||
    row.run_employee_id !== intent.employeeRef ||
    row.intent_digest !== digest(intent) ||
    digest(intent) !== digest(contextIntent) ||
    digest(intent.sourceTask) !== digest(input.task) ||
    intent.stageRef !== input.stageRef ||
    intent.employeeRef !== input.workflowContext.employeeRef ||
    input.workflowContext.role !== 'product' ||
    digest(intent.facts.binding) !== digest(input.workflowContext.binding) ||
    intent.facts.definitionDigest !== input.definitionDigest ||
    input.inputDigest !== digest(input.input)
  ) {
    refuse('REVISION_CONFLICT')
  }
  if (view) {
    const stage = view.stageTasks.find((item) => item.stageRef === intent.stageRef)
    if (
      stage?.role !== 'product' ||
      stage.taskId !== intent.sourceTask.taskId ||
      stage.employeeRef !== intent.employeeRef ||
      intent.facts.goalRef !== view.originTaskId ||
      digest(intent.facts.binding) !== digest(view.binding) ||
      intent.facts.definitionDigest !== view.definitionDigest ||
      digest(intent.facts.limits) !== digest(policy(view)) ||
      digest(intent.facts.authorizedRoles) !==
        digest(view.team.employees.map((employee) => employee.role))
    ) {
      refuse('REVISION_CONFLICT')
    }
  }
  return intent
}

export async function readWorkflowPlanIntent(db, accountId, input, view) {
  const [row] = await db`SELECT p.*,c.origin_issue_id AS origin_task_id,
    h.company_id AS run_company_id,h.agent_id AS run_employee_id
    FROM hive_workflow_plan_intents p JOIN hive_workflow_case_bindings c ON c.case_id=p.case_id
      AND c.company_id=p.company_id AND c.account_id=p.account_id
    JOIN heartbeat_runs h ON h.id=p.run_id
    WHERE p.run_id=${input.task.runId} FOR SHARE OF p,c,h`
  return validateWorkflowPlanIntentRow(row, accountId, input, view)
}

export async function readWorkflowPlanIntentRows(db, accountId, view) {
  const rows = await db`SELECT p.*,b.workflow_input,c.origin_issue_id AS origin_task_id,
    h.company_id AS run_company_id,h.agent_id AS run_employee_id FROM hive_workflow_plan_intents p
    JOIN hive_task_bindings b ON b.run_id=p.run_id AND b.account_id=p.account_id AND b.task_id=p.task_id
    JOIN hive_workflow_case_bindings c ON c.case_id=p.case_id AND c.company_id=p.company_id AND c.account_id=p.account_id
    JOIN heartbeat_runs h ON h.id=p.run_id
    WHERE p.case_id=${view.id} ORDER BY p.plan_revision DESC LIMIT 4 FOR SHARE OF p,b,c,h`
  if (rows.length > 3) {
    refuse('REVISION_CONFLICT')
  }
  for (const row of rows) {
    validateWorkflowPlanIntentRow(row, accountId, row.workflow_input, view)
  }
  return rows
}

export async function readCurrentWorkflowPlanIntent(db, accountId, view) {
  const rows = await readWorkflowPlanIntentRows(db, accountId, view)
  return rows[0]?.intent_json ?? null
}
