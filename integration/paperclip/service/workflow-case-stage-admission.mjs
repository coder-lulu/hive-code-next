import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { TaskExecutionResultSchema } from '../../../src/shared/task-execution/task-execution-receipts.ts'
import { hiveWorkflowStagePrompt } from '../../../src/shared/hive-workflow-stage-prompt.ts'
import { hiveWorkflowStageContext } from '../../../src/shared/hive-workflow-stage-context.ts'
import {
  requireWorkbenchProject,
  workbenchOwnerReferences,
  refuseWorkbench as refuse
} from './team-workbench-repository-records.mjs'
import { readWorkflowCaseView, workflowCaseAdmissionFingerprint } from './workflow-case-records.mjs'
import {
  requireLinearWorkflowDefinition,
  assertCurrentWorkflowEmployees,
  workflowStageKey
} from './workflow-pipeline-policy.mjs'
import { readWorkflowCaseConsumedEvidence } from './workflow-case-evidence-projection.mjs'
import {
  readWorkflowCaseRun,
  WorkflowRunInputSchema,
  workflowCaseRunAdmission
} from './workflow-case-run-records.mjs'
import { requireWorkflowIssueCheckout } from './workflow-issue-checkout.mjs'

function unavailable(reason) {
  throw Object.assign(new Error('CAPABILITY_UNAVAILABLE'), {
    code: 'CAPABILITY_UNAVAILABLE',
    reason
  })
}

/** Called after native settlement and the original kernel mutation, on their same transaction. */
export async function admitWorkflowCaseStageInTransaction(db, accountId, suppliedView, rawCause) {
  const cause = z
    .strictObject({ causeRunId: z.string().uuid(), stageRef: z.string().min(1).max(160) })
    .parse(rawCause)
  const owner = workbenchOwnerReferences(accountId)
  if (typeof db.begin === 'function') {
    refuse('REVISION_CONFLICT')
  }
  const { project } = await requireWorkbenchProject(
    db,
    accountId,
    suppliedView.binding.scope.projectRef
  )
  const view = await readWorkflowCaseView(db, accountId, project, suppliedView.id)
  if (workflowCaseAdmissionFingerprint(view) !== workflowCaseAdmissionFingerprint(suppliedView)) {
    refuse('REVISION_CONFLICT')
  }
  try {
    requireLinearWorkflowDefinition(view.workflow.definition)
  } catch (error) {
    if (error.message === 'CAPABILITY_UNAVAILABLE') {
      unavailable('unsupported_graph')
    }
    throw error
  }
  await assertCurrentWorkflowEmployees(db, view.binding.scope, view.team.employees)
  const accepted = (await readWorkflowCaseConsumedEvidence(db, accountId, view)).find(
    (item) => item.asset.outcome.producer.task.runId === cause.causeRunId
  )
  if (!accepted) {
    refuse('OUTCOME_UNKNOWN')
  }
  const producer = accepted.asset.outcome.producer
  const causeRecord = await readWorkflowCaseRun(
    db,
    accountId,
    producer.task.taskId,
    cause.causeRunId
  )
  if (
    causeRecord.run.caseId !== view.id ||
    !['succeeded', 'failed'].includes(causeRecord.run.status)
  ) {
    refuse('OUTCOME_UNKNOWN')
  }
  const [replay] = await db`SELECT task_id,run_id,workflow_input FROM hive_task_bindings
    WHERE account_id=${accountId} AND request_id=${cause.causeRunId} FOR SHARE`
  if (replay) {
    if (
      replay.workflow_input?.causeRunId !== cause.causeRunId ||
      replay.workflow_input?.stageRef !== cause.stageRef
    ) {
      refuse('IDEMPOTENCY_CONFLICT')
    }
    return workflowCaseRunAdmission(
      await readWorkflowCaseRun(db, accountId, replay.task_id, replay.run_id),
      true
    )
  }
  const stage = view.workflow.definition.stages.find((item) => item.stageRef === cause.stageRef)
  const fixed = view.stageTasks.find((item) => item.stageRef === cause.stageRef)
  if (!stage || !fixed || view.currentStageRef !== stage.stageRef || view.terminalKind !== null) {
    refuse('REVISION_CONFLICT')
  }
  const sameBlockedStage =
    causeRecord.run.stageRef === stage.stageRef &&
    fixed.status === 'blocked' &&
    !accepted.handoff &&
    !accepted.review
  if (
    !sameBlockedStage &&
    (accepted.handoff?.consumer.stageRef !== stage.stageRef ||
      accepted.handoff.consumer.employeeRef !== fixed.employeeRef ||
      accepted.handoff.consumer.role !== stage.role)
  ) {
    refuse('REVISION_CONFLICT')
  }
  const [business] =
    await db`SELECT c.*,c.lease_expires_at>clock_timestamp() AS lease_live FROM pipeline_cases c
    JOIN pipeline_stages s ON s.id=c.stage_id WHERE c.id=${view.id} AND c.company_id=${project.companyId}
      AND c.version=${view.revision} AND s.key=${workflowStageKey(stage.stageRef)} AND c.terminal_kind IS NULL FOR UPDATE OF c`
  if (
    !business ||
    (business.lease_live &&
      !(
        (business.lease_owner_type === 'agent' &&
          business.lease_agent_id === accepted.asset.outcome.context.employeeRef) ||
        (business.lease_owner_type === 'user' && business.lease_user_id === owner.actorRef)
      ))
  ) {
    refuse('REVISION_CONFLICT')
  }
  const [task] = await db`SELECT *,${fixed.employeeRef}::uuid AS agent_id FROM issues
    WHERE id=${fixed.taskId} AND company_id=${project.companyId} FOR UPDATE`
  if (
    !task ||
    task.assignee_agent_id !== fixed.employeeRef ||
    task.assignee_user_id !== null ||
    task.checkout_run_id !== null ||
    task.execution_run_id !== null ||
    !['backlog', 'done', 'blocked'].includes(task.status) ||
    Number(task.status_version) > 2_147_483_644
  ) {
    refuse('REVISION_CONFLICT')
  }
  const prior =
    await db`SELECT b.run_id,b.workflow_input,b.result_receipt,h.status,h.execution_stage
    FROM hive_task_bindings b JOIN heartbeat_runs h ON h.id=b.run_id
    WHERE b.task_id=${task.id} AND b.account_id=${accountId} ORDER BY b.workflow_input->'task'->>'attempt' LIMIT 4 FOR SHARE OF b,h`
  for (const [index, previous] of prior.entries()) {
    const record = await readWorkflowCaseRun(db, accountId, task.id, previous.run_id)
    const receipt = TaskExecutionResultSchema.safeParse(previous.result_receipt)
    if (
      !receipt.success ||
      receipt.data.stopProof.evidenceKind !== 'stopped' ||
      previous.status !== receipt.data.status ||
      previous.execution_stage !== 'settled' ||
      record.run.task.attempt !== index + 1
    ) {
      refuse('OUTCOME_UNKNOWN')
    }
  }
  if (prior.length >= stage.maxAttempts) {
    unavailable('attempts_exhausted')
  }
  const product = view.stageTasks.find((item) => item.role === 'product')
  const starts =
    await db`SELECT run_id,workflow_input FROM hive_task_bindings WHERE task_id=${product.taskId}
    AND account_id=${accountId} ORDER BY workflow_input->'task'->>'attempt' LIMIT 4 FOR SHARE`
  const firstRow = starts.find(
    (row) => WorkflowRunInputSchema.parse(row.workflow_input).task.attempt === 1
  )
  const first =
    firstRow && (await readWorkflowCaseRun(db, accountId, product.taskId, firstRow.run_id)).input
  if (
    !first ||
    first.caseId !== view.id ||
    first.stageRef !== product.stageRef ||
    first.workspaceSelector !== project.workspaceSelector ||
    first.definitionDigest !== view.definitionDigest ||
    first.projectBindingRevision !== view.projectBindingRevision ||
    causeRecord.input.executionDeadlineAt !== first.executionDeadlineAt
  ) {
    refuse('REVISION_CONFLICT')
  }
  const [clock] = await db`SELECT clock_timestamp() AS admitted_at`
  if (clock.admitted_at.getTime() >= Date.parse(first.executionDeadlineAt)) {
    unavailable('deadline_exceeded')
  }
  let workflowContext, prompt
  try {
    workflowContext = hiveWorkflowStageContext(view, stage.stageRef)
    prompt = hiveWorkflowStagePrompt(view, stage.stageRef, first.input)
  } catch (error) {
    if (error.message === 'CAPABILITY_UNAVAILABLE') {
      unavailable('context_unavailable')
    }
    throw error
  }
  if (prompt.length > 128_000) {
    unavailable('input_limit')
  }
  const runId = randomUUID(),
    revision = Number(task.status_version)
  const startRequest = {
    requestId: cause.causeRunId,
    projectId: project.id,
    caseId: view.id,
    expectedCaseRevision: view.revision,
    stageRef: stage.stageRef,
    expectedTaskRevision: revision
  }
  const payloadFingerprint = digest({ operation: 'cases.start', input: startRequest })
  const intent = WorkflowRunInputSchema.parse({
    caseId: view.id,
    stageRef: stage.stageRef,
    causeRunId: cause.causeRunId,
    task: {
      spaceId: project.companyId,
      taskId: task.id,
      runId,
      attempt: prior.length + 1,
      taskRevision: String(revision + 1)
    },
    startRequest,
    definitionDigest: view.definitionDigest,
    projectBindingRevision: view.projectBindingRevision,
    input: prompt,
    inputDigest: digest(prompt),
    workspaceSelector: first.workspaceSelector,
    executionDeadlineAt: first.executionDeadlineAt,
    workflowContext
  })
  await requireWorkflowIssueCheckout(db, task, runId)
  await db`INSERT INTO heartbeat_runs(id,company_id,agent_id,status,invocation_source,driver_kind)
    VALUES(${runId},${project.companyId},${fixed.employeeRef},'queued','on_demand','hive_runtime')`
  const changed =
    await db`UPDATE issues SET status='todo',status_version=status_version+1,execution_run_id=${runId},updated_at=now()
    WHERE id=${task.id} AND company_id=${project.companyId} AND status_version=${revision} AND status=${task.status}
      AND assignee_agent_id=${fixed.employeeRef} AND checkout_run_id IS NULL AND execution_run_id IS NULL RETURNING id`
  if (changed.length !== 1) {
    refuse('REVISION_CONFLICT')
  }
  await db`INSERT INTO hive_task_bindings(task_id,account_id,run_id,request_id,input_fingerprint,workspace_selector,workflow_input)
    VALUES(${task.id},${accountId},${runId},${cause.causeRunId},${payloadFingerprint},${first.workspaceSelector},${db.json(intent)})`
  const final =
    await db`SELECT id FROM pipeline_cases WHERE id=${view.id} AND company_id=${project.companyId}
    AND version=${view.revision} AND stage_id=${business.stage_id} AND terminal_kind IS NULL FOR UPDATE`
  if (final.length !== 1) {
    refuse('REVISION_CONFLICT')
  }
  const details = {
    kind: 'hive.workflow.run_admitted',
    causeRunId: cause.causeRunId,
    causeEventId: accepted.eventId,
    stageRef: stage.stageRef,
    taskId: task.id,
    runId,
    employeeRef: fixed.employeeRef,
    workflowRevision: view.binding.workflowRevision,
    definitionDigest: view.definitionDigest
  }
  await db`INSERT INTO pipeline_case_events(company_id,case_id,type,actor_type,actor_agent_id,run_id,payload)
    VALUES(${project.companyId},${view.id},'updated','agent',${accepted.asset.outcome.context.employeeRef},${cause.causeRunId},${db.json(details)})`
  await db`INSERT INTO activity_log(company_id,actor_type,actor_id,action,entity_type,entity_id,responsible_user_id,details)
    VALUES(${project.companyId},'agent',${accepted.asset.outcome.context.employeeRef},'hive.workflow.run_admitted','pipeline_case',
      ${view.id},${owner.actorRef},${db.json(details)})`
  return workflowCaseRunAdmission(await readWorkflowCaseRun(db, accountId, task.id, runId))
}
