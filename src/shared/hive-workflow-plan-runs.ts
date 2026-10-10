import { z } from 'zod'
import { HiveWorkbenchObjectIdInputSchema as IdInput } from './hive-team-workbench'
import { HiveWorkflowStageTaskSchema } from './hive-workflow-cases'
import { HiveWorkflowPlanApplicationReceiptSchema } from './hive-workflow-plan-application'
import { validateWorkflowPlanGraph } from './hive-workflow-plan-graph-validation'
import { HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS } from './hive-workflow-plan-response-budget'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
import {
  boundedTaskCollection,
  TaskCounter,
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef,
  TaskProgressSummary,
  TaskRefSchema,
  TaskTimestamp
} from './task-execution/task-execution-primitives'
import { WorkflowRoleSchema, WorkflowRunBindingSchema } from './task-workflow/workflow-bindings'
import {
  WorkflowArtifactVersionSchema,
  WorkflowCodeVersionSchema,
  WorkflowReviewSchema,
  WorkflowRoleExecutionSchema
} from './task-workflow/workflow-evidence'
import { WorkflowExecutionContextSchema } from './task-workflow/workflow-execution-context'
import { WorkflowPlanDraftSchema } from './task-workflow/workflow-plan-draft'

const Id = z.string().uuid()
const Revision = z.number().int().min(1).max(2_147_483_647)
export const HiveWorkflowPlanGraphQuerySchema = z.strictObject({
  projectId: IdInput,
  caseId: IdInput,
  applicationRef: IdInput
})
export const HiveWorkflowPlanGraphStartSchema = HiveWorkflowPlanGraphQuerySchema.extend({
  requestId: IdInput,
  expectedCaseRevision: Revision,
  expectedProjectRevision: TaskEpoch,
  requestedDurationMs: z.number().int().min(1000).max(86_400_000),
  draftDigest: TaskDigest,
  proposalDigest: TaskDigest
})
export const HiveWorkflowPlanGraphMutationSchema = HiveWorkflowPlanGraphQuerySchema.extend({
  requestId: IdInput,
  graphRef: IdInput,
  expectedGraphRevision: Revision
})
export const HiveWorkflowPlanGraphRetrySchema = HiveWorkflowPlanGraphMutationSchema.extend({
  taskId: IdInput,
  causeRunId: IdInput,
  expectedTaskRevision: TaskCounter
})
export const HiveWorkflowPlanGraphControlSchema = z
  .strictObject({
    graphRef: Id,
    applicationRef: Id,
    requestId: Id,
    binding: WorkflowRunBindingSchema,
    planRevision: TaskEpoch,
    draftDigest: TaskDigest,
    proposalDigest: TaskDigest,
    projectBindingRevision: TaskEpoch,
    revision: Revision,
    status: z.enum(['running', 'paused', 'cancel_requested', 'done', 'cancelled']),
    startedAt: TaskTimestamp,
    deadlineAt: TaskTimestamp,
    maxParallelism: z.number().int().min(1).max(4),
    maxDurationMs: z.number().int().min(1000).max(86_400_000),
    retryBackoffMs: z.literal(1000),
    pauseCause: z
      .strictObject({
        kind: z.literal('admission_unavailable'),
        causeRunId: Id,
        proposalTaskRef: TaskOpaqueRef.optional(),
        code: z.enum(['FORBIDDEN', 'REVISION_CONFLICT', 'CAPABILITY_UNAVAILABLE']),
        reason: z.enum([
          'authorization_unavailable',
          'capability_unavailable',
          'revision_conflict',
          'deadline_exceeded',
          'role_unavailable',
          'project_binding_changed',
          'source_busy',
          'source_case_cancelled',
          'resource_loading_unavailable',
          'knowledge_access_unavailable',
          'hard_budget_unavailable',
          'unsupported_graph',
          'independent_review_required'
        ])
      })
      .optional()
  })
  .superRefine((graph, context) => {
    if (
      (graph.pauseCause && graph.status !== 'paused') ||
      Date.parse(graph.deadlineAt) - Date.parse(graph.startedAt) !== graph.maxDurationMs
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_plan_graph_deadline_mismatch' })
    }
  })
export const HiveWorkflowPlanGraphTaskSchema = z.strictObject({
  proposalTaskRef: TaskOpaqueRef,
  taskId: Id,
  employeeRef: Id,
  role: WorkflowRoleSchema,
  taskRevision: TaskCounter,
  status: HiveWorkflowStageTaskSchema.shape.status,
  maxAttempts: z.number().int().min(1).max(3),
  latestRun: TaskRefSchema.nullable(),
  blockedReason: z
    .enum([
      'waiting_dependency',
      'capability_unavailable',
      'authorization_unavailable',
      'unknown',
      'cancel_requested',
      'failed',
      'review_rejected',
      'attempts_exhausted',
      'deadline_exceeded',
      'retry_backoff'
    ])
    .nullable()
})
export const HiveWorkflowPlanGraphRunSchema = z
  .strictObject({
    graphRef: Id,
    applicationRef: Id,
    proposalTaskRef: TaskOpaqueRef,
    role: WorkflowRoleSchema,
    employeeRef: Id,
    task: TaskRefSchema,
    status: z.enum([
      'pending',
      'running',
      'cancelRequested',
      'unknown',
      'succeeded',
      'failed',
      'cancelled'
    ]),
    hasResult: z.boolean()
  })
  .superRefine((run, context) => {
    if (run.hasResult !== ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      context.addIssue({ code: 'custom', message: 'workflow_plan_graph_run_result_mismatch' })
    }
  })
export const HiveWorkflowPlanGraphOutcomeSchema = z
  .strictObject({
    kind: z.literal('workflow.plan-task-outcome'),
    outcomeRef: TaskOpaqueRef,
    graphRef: Id,
    applicationRef: Id,
    proposalTaskRef: TaskOpaqueRef,
    producer: WorkflowRoleExecutionSchema,
    status: z.enum(['succeeded', 'failed']),
    nativeOutcomeVersion: WorkflowArtifactVersionSchema,
    reportVersion: WorkflowArtifactVersionSchema,
    summary: TaskProgressSummary,
    codeVersion: WorkflowCodeVersionSchema.optional(),
    review: WorkflowReviewSchema.optional()
  })
  .superRefine((outcome, context) => {
    if (
      outcome.review &&
      (outcome.producer.role !== 'tester' ||
        digest(outcome.review.reviewer) !== digest(outcome.producer) ||
        outcome.review.stageRef !== outcome.proposalTaskRef ||
        outcome.review.binding.scope.companyRef !== outcome.producer.task.spaceId)
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_plan_graph_review_mismatch' })
    }
  })
export const HiveWorkflowPlanGraphViewSchema = z
  .strictObject({
    caseId: Id,
    projectId: Id,
    application: HiveWorkflowPlanApplicationReceiptSchema,
    draft: WorkflowPlanDraftSchema,
    graph: HiveWorkflowPlanGraphControlSchema.nullable(),
    tasks: boundedTaskCollection(HiveWorkflowPlanGraphTaskSchema, 32, 1),
    runs: boundedTaskCollection(HiveWorkflowPlanGraphRunSchema, 96),
    outcomes: boundedTaskCollection(HiveWorkflowPlanGraphOutcomeSchema, 96),
    availability: z.discriminatedUnion('available', [
      z.strictObject({ available: z.literal(true) }),
      z.strictObject({
        available: z.literal(false),
        reason: z.enum([
          'graph_not_started',
          'source_case_cancelled',
          'source_busy',
          'project_binding_changed',
          'role_unavailable',
          'resource_loading_unavailable',
          'knowledge_access_unavailable',
          'hard_budget_unavailable',
          'unsupported_graph',
          'independent_review_required',
          'deadline_exceeded',
          'graph_paused',
          'graph_cancelled'
        ])
      })
    ])
  })
  .superRefine(validateWorkflowPlanGraph)
const Admission = z.strictObject({
  requestId: Id,
  payloadFingerprint: TaskDigest,
  replayed: z.boolean()
})
export const HiveWorkflowPlanGraphReplySchema = z.strictObject({
  admission: Admission,
  view: HiveWorkflowPlanGraphViewSchema
})
export const HiveWorkflowPlanRunReadSchema = HiveWorkflowPlanGraphQuerySchema.extend({
  taskId: IdInput,
  runId: IdInput
})
export const HiveWorkflowPlanRunStartRequestSchema = z.strictObject({
  requestId: Id,
  graphRef: Id,
  applicationRef: Id,
  projectId: Id,
  caseId: Id,
  proposalTaskRef: TaskOpaqueRef,
  expectedTaskRevision: TaskCounter,
  attempt: z.number().int().min(1).max(3)
})
export const HiveWorkflowPlanRunAdmissionSchema = Admission.extend({
  run: HiveWorkflowPlanGraphRunSchema,
  startRequest: HiveWorkflowPlanRunStartRequestSchema,
  definitionDigest: TaskDigest,
  projectBindingRevision: TaskEpoch,
  input: z.string().min(1).max(HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS),
  inputDigest: TaskDigest,
  workspaceSelector: z.string().min(1).max(512),
  executionDeadlineAt: TaskTimestamp,
  workflowContext: WorkflowExecutionContextSchema
}).superRefine((admission, context) => {
  const { run, startRequest: request, workflowContext: workflow } = admission
  const plan = workflow.planExecution
  if (
    !plan ||
    admission.requestId !== request.requestId ||
    request.graphRef !== run.graphRef ||
    request.applicationRef !== run.applicationRef ||
    request.proposalTaskRef !== run.proposalTaskRef ||
    request.attempt !== run.task.attempt ||
    String(request.expectedTaskRevision + 1) !== run.task.taskRevision ||
    workflow.binding.workflowRunRef !== request.caseId ||
    workflow.binding.scope.projectRef !== request.projectId ||
    workflow.definitionDigest !== admission.definitionDigest ||
    workflow.role !== run.role ||
    workflow.employeeRef !== run.employeeRef ||
    plan.graphRef !== run.graphRef ||
    plan.applicationRef !== run.applicationRef ||
    plan.proposalTaskRef !== run.proposalTaskRef ||
    digest(plan.sourceTask) !== digest(run.task)
  ) {
    context.addIssue({ code: 'custom', message: 'workflow_plan_graph_admission_mismatch' })
  }
})
export type HiveWorkflowPlanGraphQuery = z.infer<typeof HiveWorkflowPlanGraphQuerySchema>
export type HiveWorkflowPlanGraphStart = z.infer<typeof HiveWorkflowPlanGraphStartSchema>
export type HiveWorkflowPlanGraphMutation = z.infer<typeof HiveWorkflowPlanGraphMutationSchema>
export type HiveWorkflowPlanGraphRetry = z.infer<typeof HiveWorkflowPlanGraphRetrySchema>
export type HiveWorkflowPlanGraphControl = z.infer<typeof HiveWorkflowPlanGraphControlSchema>
export type HiveWorkflowPlanGraphTask = z.infer<typeof HiveWorkflowPlanGraphTaskSchema>
export type HiveWorkflowPlanGraphRun = z.infer<typeof HiveWorkflowPlanGraphRunSchema>
export type HiveWorkflowPlanGraphOutcome = z.infer<typeof HiveWorkflowPlanGraphOutcomeSchema>
export type HiveWorkflowPlanGraphView = z.infer<typeof HiveWorkflowPlanGraphViewSchema>
export type HiveWorkflowPlanGraphReply = z.infer<typeof HiveWorkflowPlanGraphReplySchema>
export type HiveWorkflowPlanRunRead = z.infer<typeof HiveWorkflowPlanRunReadSchema>
export type HiveWorkflowPlanRunStartRequest = z.infer<typeof HiveWorkflowPlanRunStartRequestSchema>
export type HiveWorkflowPlanRunAdmission = z.infer<typeof HiveWorkflowPlanRunAdmissionSchema>
export type HiveWorkflowPlanRunsApi = {
  getWorkflowPlanGraph(query: HiveWorkflowPlanGraphQuery): Promise<HiveWorkflowPlanGraphView>
  startWorkflowPlanGraph(input: HiveWorkflowPlanGraphStart): Promise<HiveWorkflowPlanGraphReply>
  cancelWorkflowPlanGraph(input: HiveWorkflowPlanGraphMutation): Promise<HiveWorkflowPlanGraphReply>
  resumeWorkflowPlanGraph(input: HiveWorkflowPlanGraphMutation): Promise<HiveWorkflowPlanGraphReply>
  retryWorkflowPlanTask(input: HiveWorkflowPlanGraphRetry): Promise<HiveWorkflowPlanGraphReply>
}
