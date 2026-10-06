import { z } from 'zod'
import { HiveWorkbenchObjectIdInputSchema } from './hive-team-workbench'
import {
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef,
  TaskRefSchema,
  TaskTimestamp
} from './task-execution/task-execution-primitives'
import { WorkflowRoleSchema } from './task-workflow/workflow-bindings'
import { WorkflowExecutionContextSchema } from './task-workflow/workflow-execution-context'

export const HiveWorkflowCaseStartSchema = z.strictObject({
  requestId: HiveWorkbenchObjectIdInputSchema,
  projectId: HiveWorkbenchObjectIdInputSchema,
  caseId: HiveWorkbenchObjectIdInputSchema,
  expectedCaseRevision: z.number().int().min(1).max(2_147_483_647),
  stageRef: TaskOpaqueRef,
  expectedTaskRevision: z.number().int().min(0).max(2_147_483_644)
})

export const HiveWorkflowCaseRunSchema = z
  .strictObject({
    caseId: z.string().uuid(),
    stageRef: TaskOpaqueRef,
    role: WorkflowRoleSchema,
    employeeRef: z.string().uuid(),
    startRequest: HiveWorkflowCaseStartSchema,
    task: TaskRefSchema.extend({
      spaceId: z.string().uuid(),
      taskId: z.string().uuid(),
      runId: z.string().uuid(),
      taskRevision: z.string().regex(/^(?:0|[1-9]\d{0,15})$/)
    }),
    title: z.string().min(1).max(240),
    status: z.enum([
      'pending',
      'running',
      'cancelRequested',
      'unknown',
      'succeeded',
      'failed',
      'cancelled'
    ]),
    artifactRefs: z.array(TaskOpaqueRef).max(32)
  })
  .superRefine((run, context) => {
    if (
      run.caseId !== run.startRequest.caseId ||
      run.stageRef !== run.startRequest.stageRef ||
      run.task.taskRevision !== String(run.startRequest.expectedTaskRevision + 1)
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_run_admission_mismatch' })
    }
  })
export const HiveWorkflowCaseRunsSchema = z.array(HiveWorkflowCaseRunSchema).max(96)
export const HiveWorkflowCaseRunReadSchema = z.strictObject({
  projectId: HiveWorkbenchObjectIdInputSchema,
  caseId: HiveWorkbenchObjectIdInputSchema,
  taskId: HiveWorkbenchObjectIdInputSchema,
  runId: HiveWorkbenchObjectIdInputSchema
})

// Private service-to-Main admission: the host still issues and verifies execution authority.
export const HiveWorkflowCaseRunAdmissionSchema = z.strictObject({
  requestId: z.string().uuid(),
  payloadFingerprint: TaskDigest,
  replayed: z.boolean(),
  run: HiveWorkflowCaseRunSchema,
  definitionDigest: TaskDigest,
  projectBindingRevision: TaskEpoch,
  input: z.string().min(1).max(128_000),
  inputDigest: TaskDigest,
  workspaceSelector: z.string().min(1).max(512),
  executionDeadlineAt: TaskTimestamp,
  workflowContext: WorkflowExecutionContextSchema.optional()
})

export type HiveWorkflowCaseStart = z.infer<typeof HiveWorkflowCaseStartSchema>
export type HiveWorkflowCaseRun = z.infer<typeof HiveWorkflowCaseRunSchema>
export type HiveWorkflowCaseRunsApi = {
  startWorkflowCase(input: HiveWorkflowCaseStart): Promise<HiveWorkflowCaseRun>
  getWorkflowCaseRuns(query: { projectId: string; caseId: string }): Promise<HiveWorkflowCaseRun[]>
}
