import { z } from 'zod'
import { HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS } from '../../../src/shared/hive-workflow-plan-response-budget.ts'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  HiveWorkflowPlanGraphControlSchema,
  HiveWorkflowPlanGraphViewSchema,
  HiveWorkflowPlanGraphRunSchema,
  HiveWorkflowPlanGraphOutcomeSchema,
  HiveWorkflowPlanRunAdmissionSchema,
  HiveWorkflowPlanRunStartRequestSchema
} from '../../../src/shared/hive-workflow-plan-runs.ts'
import { WorkflowExecutionContextSchema } from '../../../src/shared/task-workflow/workflow-execution-context.ts'
import { TaskRefSchema } from '../../../src/shared/task-execution/task-execution-primitives.ts'
import { computeTaskExecutionFingerprint } from '../../../src/shared/task-execution/task-execution-fingerprint.ts'
import { HiveRuntimeAdapterBinding } from '../../../src/main/tasks/paperclip-adapter-contract.ts'
import {
  hiveWorkflowPlanGraphContext,
  hiveWorkflowPlanGraphPrompt
} from '../../../src/shared/hive-workflow-plan-graph-context.ts'
import { readPlanSource, readPlanApplication } from './workflow-plan-application-records.mjs'
import { planGraphAvailability } from './workflow-plan-graph-policy.mjs'
import { refuseWorkbench as refuse } from './team-workbench-repository-records.mjs'

export const PlanRunInputSchema = z.strictObject({
  graphRef: z.string().uuid(),
  applicationRef: z.string().uuid(),
  caseId: z.string().uuid(),
  stageRef: z.string().min(1).max(160),
  task: TaskRefSchema,
  startRequest: HiveWorkflowPlanRunStartRequestSchema,
  definitionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  projectBindingRevision: z.number().int().positive(),
  input: z.string().min(1).max(HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS),
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceSelector: z.string().min(1).max(512),
  executionDeadlineAt: z.string().datetime(),
  workflowContext: WorkflowExecutionContextSchema
})

/** Bound execution consumes its original authenticated input, not today's prompt template. */
export function validatePlanRunBinding(source, input, rawBinding) {
  const binding = HiveRuntimeAdapterBinding.parse(rawBinding),
    command = binding.command
  const employee = source.view.team.employees.find(
    (item) => item.employeeRef === input.workflowContext.employeeRef
  )
  if (
    !employee ||
    employee.role !== input.workflowContext.role ||
    binding.paperclipCompanyId !== source.project.companyId ||
    binding.paperclipAgentId !== employee.employeeRef ||
    binding.commandFingerprint !==
      computeTaskExecutionFingerprint(command, 'trusted-local:runtime') ||
    digest(command.task) !== digest(input.task) ||
    command.profileId !== employee.profileRef ||
    command.profileRevision !== employee.profileRevision ||
    command.workspaceRef !== source.view.team.project.hiveWorkspaceRef ||
    command.executionAccountRef !== source.view.team.company.ownerAccountRef ||
    command.executionPolicy.trustMode !== 'enforced_autonomous' ||
    digest(command.ownerScope) !== digest(source.view.team.company.ownerScope) ||
    digest(command.workflowContext) !== digest(input.workflowContext) ||
    command.executionDeadlineAt !== input.executionDeadlineAt ||
    input.inputDigest !== digest(input.input) ||
    command.inputRef !== `input:${input.inputDigest}`
  ) {
    refuse('REVISION_CONFLICT')
  }
}

export async function readPlanGraphSource(db, accountId, query) {
  const [app] =
    await db`SELECT draft_json,case_id FROM hive_workflow_plan_applications WHERE application_id=${query.applicationRef} AND account_id=${accountId}`
  if (!app || app.case_id !== query.caseId) {
    refuse('FORBIDDEN')
  }
  const source = await readPlanSource(
    db,
    accountId,
    { ...query, draftRef: app.draft_json.draftRef },
    true
  )
  const record = await readPlanApplication(db, accountId, source)
  if (!record.application || record.application.applicationRef !== query.applicationRef) {
    refuse('FORBIDDEN')
  }
  return {
    ...source,
    draft: record.originalDraft,
    application: record.application,
    taskStates: record.taskStates
  }
}

export async function readPlanGraphRows(db, accountId, source) {
  const [row] =
    await db`SELECT * FROM hive_workflow_plan_graphs WHERE application_id=${source.application.applicationRef} FOR UPDATE`
  const graph = row ? HiveWorkflowPlanGraphControlSchema.parse(row.control_json) : null
  if (graph && (graph.graphRef !== row.graph_id || graph.applicationRef !== row.application_id)) {
    refuse('REVISION_CONFLICT')
  }
  const rows = graph
    ? await db`SELECT b.*,h.status AS run_status,h.execution_stage,h.finished_at,h.company_id AS run_company_id,h.agent_id,h.driver_kind,
    (b.cancel_requested OR h.context_snapshot->'externalExecutionControl'->'cancel' IS NOT NULL) AS cancelling
    FROM hive_task_bindings b JOIN heartbeat_runs h ON h.id=b.run_id
    WHERE b.account_id=${accountId} AND b.workflow_input->>'graphRef'=${graph.graphRef} ORDER BY h.created_at,b.run_id LIMIT 97 FOR SHARE OF b,h`
    : []
  if (rows.length > 96) {
    refuse('REVISION_CONFLICT')
  }
  const outcomes = graph
    ? (
        await db`SELECT outcome_json FROM hive_workflow_plan_graph_outcomes WHERE graph_id=${graph.graphRef} ORDER BY created_at,run_id LIMIT 97`
      ).map((item) => HiveWorkflowPlanGraphOutcomeSchema.parse(item.outcome_json))
    : []
  const runs = rows.map((row) => {
    const input = PlanRunInputSchema.parse(row.workflow_input)
    const mapping = source.application.createdTaskRefs.find((item) => item.taskId === row.task_id)
    const proposal = source.draft.inspection.proposal.tasks.find(
      (item) => item.taskRef === mapping?.proposalTaskRef
    )
    if (
      !mapping ||
      !proposal ||
      row.run_company_id !== source.project.companyId ||
      row.agent_id !== mapping.employeeRef ||
      row.driver_kind !== 'hive_runtime' ||
      input.graphRef !== graph.graphRef ||
      input.applicationRef !== source.application.applicationRef ||
      input.caseId !== source.view.id ||
      input.stageRef !== mapping.proposalTaskRef ||
      input.task.runId !== row.run_id ||
      input.task.taskId !== row.task_id ||
      input.task.spaceId !== source.project.companyId ||
      input.startRequest.requestId !== row.request_id ||
      row.input_fingerprint !==
        digest({ operation: 'plans.run.start', input: input.startRequest }) ||
      input.inputDigest !== digest(input.input) ||
      input.executionDeadlineAt !== graph.deadlineAt
    ) {
      refuse('REVISION_CONFLICT')
    }
    const status =
      row.result_receipt?.status ??
      (row.execution_stage === 'outcome_unknown'
        ? 'unknown'
        : row.cancelling
          ? 'cancelRequested'
          : row.run_status === 'queued'
            ? 'pending'
            : row.run_status === 'running'
              ? 'running'
              : 'unknown')
    return HiveWorkflowPlanGraphRunSchema.parse({
      graphRef: graph.graphRef,
      applicationRef: graph.applicationRef,
      proposalTaskRef: proposal.taskRef,
      role: proposal.requestedRole,
      employeeRef: mapping.employeeRef,
      task: input.task,
      status,
      hasResult: row.result_receipt !== null
    })
  })
  for (const row of rows) {
    const input = PlanRunInputSchema.parse(row.workflow_input)
    const snapshot = { graph, draft: source.draft, application: source.application, outcomes, runs }
    const context = hiveWorkflowPlanGraphContext(source.view, snapshot, input.stageRef, input.task)
    if (
      digest(context) !== digest(input.workflowContext) ||
      (!row.binding &&
        hiveWorkflowPlanGraphPrompt(source.view, snapshot, input.stageRef, context) !==
          input.input) ||
      input.definitionDigest !== source.view.definitionDigest ||
      input.projectBindingRevision !== source.view.projectBindingRevision ||
      input.workspaceSelector !== row.workspace_selector ||
      input.workspaceSelector !== source.project.workspaceSelector
    ) {
      refuse('REVISION_CONFLICT')
    }
    if (row.binding) {
      validatePlanRunBinding(source, input, row.binding)
    }
  }
  for (const outcome of outcomes) {
    const row = rows.find((item) => item.run_id === outcome.producer.task.runId)
    const command = row?.binding?.command,
      producer = outcome.producer
    if (
      !command ||
      !row.result_receipt ||
      digest(producer.task) !== digest(command.task) ||
      producer.commandFingerprint !== row.binding.commandFingerprint ||
      producer.runtimeRecordId !== command.runtimeRecordId ||
      producer.ownershipEpoch !== command.ownershipEpoch ||
      producer.executionId !== command.executionId ||
      producer.executionEpoch !== command.executionEpoch ||
      producer.workspaceExecutionClaimRef !== command.workspaceExecutionClaimRef ||
      producer.employeeRef !== row.agent_id ||
      outcome.status !== row.result_receipt.status ||
      row.execution_stage !== 'settled'
    ) {
      refuse('REVISION_CONFLICT')
    }
  }
  return { graph, rows, runs, outcomes }
}

export async function planGraphView(db, accountId, source, records) {
  const { graph, runs, outcomes } = records
  const reason = await planGraphAvailability(db, accountId, source, graph)
  return HiveWorkflowPlanGraphViewSchema.parse({
    caseId: source.view.id,
    projectId: source.project.id,
    application: source.application,
    draft: source.draft,
    graph,
    runs,
    outcomes,
    availability: reason ? { available: false, reason } : { available: true },
    tasks: source.application.createdTaskRefs.map((mapping) => {
      const proposed = source.draft.inspection.proposal.tasks.find(
        (item) => item.taskRef === mapping.proposalTaskRef
      )
      const state = source.taskStates.find((item) => item.taskId === mapping.taskId)
      const latest = runs
        .filter((item) => item.task.taskId === mapping.taskId)
        .sort((a, b) => b.task.attempt - a.task.attempt)[0]
      const outcome = outcomes.find((item) => item.producer.task.runId === latest?.task.runId)
      const blockedReason =
        !latest && graph?.pauseCause?.proposalTaskRef === mapping.proposalTaskRef
          ? graph.pauseCause.code === 'FORBIDDEN'
            ? 'authorization_unavailable'
            : 'capability_unavailable'
          : latest?.status === 'unknown'
            ? 'unknown'
            : latest?.status === 'cancelRequested'
              ? 'cancel_requested'
              : outcome?.review && outcome.review.decision !== 'approved'
                ? 'review_rejected'
                : latest?.status === 'failed'
                  ? latest.task.attempt >= proposed.maxAttempts
                    ? 'attempts_exhausted'
                    : 'failed'
                  : !latest && proposed.dependsOn.length
                    ? 'waiting_dependency'
                    : null
      return {
        proposalTaskRef: mapping.proposalTaskRef,
        taskId: mapping.taskId,
        employeeRef: mapping.employeeRef,
        role: proposed.requestedRole,
        taskRevision: state.taskRevision,
        status: state.status,
        maxAttempts: proposed.maxAttempts,
        latestRun: latest?.task ?? null,
        blockedReason
      }
    })
  })
}

export function planRunAdmission(source, records, taskId, runId) {
  const row = records.rows.find((item) => item.task_id === taskId && item.run_id === runId)
  const run = records.runs.find((item) => item.task.taskId === taskId && item.task.runId === runId)
  if (!row || !run) {
    refuse('FORBIDDEN')
  }
  const input = PlanRunInputSchema.parse(row.workflow_input)
  return HiveWorkflowPlanRunAdmissionSchema.parse({
    requestId: row.request_id,
    payloadFingerprint: row.input_fingerprint,
    replayed: true,
    run,
    startRequest: input.startRequest,
    definitionDigest: input.definitionDigest,
    projectBindingRevision: input.projectBindingRevision,
    input: input.input,
    inputDigest: input.inputDigest,
    workspaceSelector: input.workspaceSelector,
    executionDeadlineAt: input.executionDeadlineAt,
    workflowContext: input.workflowContext
  })
}

export async function storePlanGraph(db, graph, status = graph.status, pauseCause) {
  const { pauseCause: previousCause, ...control } = graph
  const next = HiveWorkflowPlanGraphControlSchema.parse({
    ...control,
    status,
    revision: graph.revision + 1,
    ...(status === 'paused' && (pauseCause ?? previousCause)
      ? { pauseCause: pauseCause ?? previousCause }
      : {})
  })
  await db`UPDATE hive_workflow_plan_graphs SET control_json=${db.json(next)} WHERE graph_id=${graph.graphRef}`
  return next
}
