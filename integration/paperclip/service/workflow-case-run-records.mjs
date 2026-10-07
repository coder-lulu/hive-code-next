import { z } from 'zod'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  HiveWorkflowCaseRunSchema,
  HiveWorkflowCaseRunAdmissionSchema,
  HiveWorkflowCaseStartSchema
} from '../../../src/shared/hive-workflow-case-runs.ts'
import { TaskRefSchema } from '../../../src/shared/task-execution/task-execution-primitives.ts'
import {
  requireWorkbenchProject,
  refuseWorkbench as refuse
} from './team-workbench-repository-records.mjs'
import { readWorkflowCaseView } from './workflow-case-records.mjs'
import { createTaskRunScopeReader } from './task-run-scope.mjs'

export const WorkflowRunInputSchema = HiveWorkflowCaseRunAdmissionSchema.pick({
  input: true,
  inputDigest: true,
  definitionDigest: true,
  projectBindingRevision: true,
  workspaceSelector: true,
  executionDeadlineAt: true,
  workflowContext: true
}).extend({
  caseId: z.string().uuid(),
  stageRef: z.string().min(1).max(160),
  task: TaskRefSchema,
  startRequest: HiveWorkflowCaseStartSchema,
  causeRunId: z.string().uuid().optional()
})

export async function readWorkflowCaseRun(db, accountId, taskId, runId) {
  const task = await createTaskRunScopeReader(db).read(db, accountId, taskId, runId)
  const [binding] = await db`SELECT request_id,input_fingerprint,workflow_input
    FROM hive_task_bindings WHERE account_id=${accountId} AND task_id=${taskId} AND run_id=${runId} FOR SHARE`
  const parsed = WorkflowRunInputSchema.safeParse(binding?.workflow_input)
  if (!parsed.success || task.run_scope.kind !== 'workbenchCase') {
    refuse('REVISION_CONFLICT')
  }
  const input = parsed.data,
    scope = task.run_scope
  if (
    input.caseId !== scope.caseId ||
    input.stageRef !== scope.stageRef ||
    input.task.spaceId !== scope.companyId ||
    input.task.taskId !== task.id ||
    input.task.runId !== runId ||
    input.definitionDigest !== scope.definitionDigest ||
    input.projectBindingRevision !== scope.projectBindingRevision ||
    input.workspaceSelector !== scope.workspaceSelector ||
    input.inputDigest !== digest(input.input) ||
    input.startRequest.requestId !== binding.request_id ||
    input.startRequest.projectId !== scope.projectId ||
    (input.causeRunId &&
      (input.causeRunId === runId || input.startRequest.requestId !== input.causeRunId)) ||
    (input.workflowContext &&
      (digest(input.workflowContext.binding) !==
        digest({
          scope: { companyRef: scope.companyId, projectRef: scope.projectId },
          workflowRef: scope.workflowId,
          workflowRevision: scope.workflowRevision,
          workflowRunRef: scope.caseId
        }) ||
        input.workflowContext.stageRef !== scope.stageRef ||
        input.workflowContext.role !== scope.role ||
        input.workflowContext.employeeRef !== scope.employeeRef ||
        input.workflowContext.definitionDigest !== scope.definitionDigest)) ||
    binding.input_fingerprint !== digest({ operation: 'cases.start', input: input.startRequest }) ||
    (task.binding &&
      (digest(task.binding.command.task) !== digest(input.task) ||
        task.binding.command.executionDeadlineAt !== input.executionDeadlineAt ||
        digest(task.binding.command.workflowContext ?? {}) !== digest(input.workflowContext ?? {})))
  ) {
    refuse('REVISION_CONFLICT')
  }
  const status =
    task.result_receipt?.status ??
    (task.execution_stage === 'outcome_unknown'
      ? 'unknown'
      : task.cancel_requested
        ? 'cancelRequested'
        : task.run_status === 'queued'
          ? 'pending'
          : task.run_status === 'running'
            ? 'running'
            : 'unknown')
  const run = HiveWorkflowCaseRunSchema.parse({
    caseId: scope.caseId,
    stageRef: scope.stageRef,
    role: scope.role,
    employeeRef: scope.employeeRef,
    task: input.task,
    title: task.title,
    status,
    artifactRefs: task.result_receipt?.artifactRefs ?? [],
    startRequest: input.startRequest
  })
  return {
    run,
    input,
    requestId: binding.request_id,
    payloadFingerprint: binding.input_fingerprint
  }
}

export function workflowCaseRunAdmission(record, replayed = false) {
  return HiveWorkflowCaseRunAdmissionSchema.parse({
    requestId: record.requestId,
    payloadFingerprint: record.payloadFingerprint,
    replayed,
    run: record.run,
    definitionDigest: record.input.definitionDigest,
    projectBindingRevision: record.input.projectBindingRevision,
    input: record.input.input,
    inputDigest: record.input.inputDigest,
    workspaceSelector: record.input.workspaceSelector,
    executionDeadlineAt: record.input.executionDeadlineAt,
    workflowContext: record.input.workflowContext
  })
}

export async function requireWorkflowCase(db, accountId, query, write = false) {
  const { project } = await requireWorkbenchProject(db, accountId, query.projectId, write)
  const view = await readWorkflowCaseView(db, accountId, project, query.caseId)
  return { project, view }
}

export async function requireWorkflowCaseRunDispatch(db, accountId, task) {
  if (task.run_scope.kind !== 'workbenchCase') {
    return
  }
  const scope = task.run_scope
  const record = await readWorkflowCaseRun(db, accountId, task.id, task.run_id)
  const { view } = await requireWorkflowCase(db, accountId, {
    projectId: scope.projectId,
    caseId: scope.caseId
  })
  const [clock] = await db`SELECT clock_timestamp() AS now`
  if (
    task.cancel_requested ||
    record.run.status !== 'pending' ||
    view.terminalKind !== null ||
    view.currentStageRef !== scope.stageRef ||
    view.revision !== record.run.startRequest.expectedCaseRevision ||
    clock.now.getTime() >= Date.parse(record.input.executionDeadlineAt)
  ) {
    refuse('REVISION_CONFLICT')
  }
}
