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
  executionDeadlineAt: true
}).extend({
  caseId: z.string().uuid(),
  stageRef: z.string().min(1).max(160),
  task: TaskRefSchema,
  startRequest: HiveWorkflowCaseStartSchema
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
    binding.input_fingerprint !== digest({ operation: 'cases.start', input: input.startRequest }) ||
    (task.binding &&
      (digest(task.binding.command.task) !== digest(input.task) ||
        task.binding.command.executionDeadlineAt !== input.executionDeadlineAt))
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

export async function requireWorkflowCase(db, accountId, query, write = false) {
  const { project } = await requireWorkbenchProject(db, accountId, query.projectId, write)
  const view = await readWorkflowCaseView(db, accountId, project, query.caseId)
  return { project, view }
}
