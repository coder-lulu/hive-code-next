import { z } from 'zod'
import { HiveWorkbenchObjectIdInputSchema } from './hive-team-workbench'
import { HiveWorkflowSnapshotSchema } from './hive-task-workflows'
import {
  boundedTaskCollection,
  TaskCounter,
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef,
  TaskTimestamp
} from './task-execution/task-execution-primitives'
import {
  WorkflowRoleSchema,
  WorkflowRunBindingSchema,
  WorkflowTeamBindingSchema
} from './task-workflow/workflow-bindings'
import { WORKFLOW_STAGE_LIMITS } from './task-workflow/workflow-definition'
import { WorkflowHandoffSchema, WorkflowReviewSchema } from './task-workflow/workflow-evidence'
import { canonicalAgentSessionDigest as digest } from './agent-session-mutation-envelope'

const ObjectId = z.string().uuid()
const Title = z.string().trim().min(1).max(240)
const Requirement = z.string().trim().min(1).max(48_000)
const CaseRevision = z.number().int().min(1).max(2_147_483_647)

export const HIVE_WORKFLOW_CASE_MAX_REQUEST_BYTES = 320 * 1024

export const HiveWorkflowCaseCreateSchema = z.strictObject({
  requestId: HiveWorkbenchObjectIdInputSchema,
  projectId: HiveWorkbenchObjectIdInputSchema,
  workflowId: HiveWorkbenchObjectIdInputSchema,
  workflowRevision: TaskEpoch,
  definitionDigest: TaskDigest,
  expectedProjectRevision: TaskEpoch,
  title: Title,
  requirement: Requirement
})
export const HiveWorkflowCaseListQuerySchema = z.strictObject({
  projectId: HiveWorkbenchObjectIdInputSchema,
  workflowId: HiveWorkbenchObjectIdInputSchema.optional(),
  after: HiveWorkbenchObjectIdInputSchema.optional(),
  limit: z.number().int().min(1).max(50).default(25)
})
export const HiveWorkflowCaseReadQuerySchema = z.strictObject({
  projectId: HiveWorkbenchObjectIdInputSchema,
  caseId: HiveWorkbenchObjectIdInputSchema
})
const CaseSummary = z.strictObject({
  id: ObjectId,
  title: Title,
  binding: WorkflowRunBindingSchema.extend({
    scope: z.strictObject({ companyRef: ObjectId, projectRef: ObjectId }),
    workflowRef: ObjectId,
    workflowRunRef: ObjectId
  }),
  definitionDigest: TaskDigest,
  projectBindingRevision: TaskEpoch,
  revision: CaseRevision,
  currentStageRef: TaskOpaqueRef.nullable(),
  terminalKind: z.enum(['done', 'cancelled']).nullable(),
  createdAt: TaskTimestamp,
  updatedAt: TaskTimestamp
})
function invalidCaseSummary(view: z.infer<typeof CaseSummary>) {
  return (
    view.id !== view.binding.workflowRunRef ||
    (view.terminalKind === null ? view.currentStageRef === null : view.currentStageRef !== null)
  )
}
export const HiveWorkflowCaseSummarySchema = CaseSummary.superRefine((view, context) => {
  if (invalidCaseSummary(view)) {
    context.addIssue({ code: 'custom', message: 'workflow_case_binding_mismatch' })
  }
})
export const HiveWorkflowStageTaskSchema = z.strictObject({
  stageRef: TaskOpaqueRef,
  taskId: ObjectId,
  employeeRef: ObjectId,
  role: WorkflowRoleSchema,
  taskRevision: TaskCounter,
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'])
})
export const HiveWorkflowCaseViewSchema = CaseSummary.extend({
  requirement: Requirement,
  originTaskId: ObjectId,
  workflow: HiveWorkflowSnapshotSchema,
  team: WorkflowTeamBindingSchema,
  handoffs: boundedTaskCollection(WorkflowHandoffSchema, 96),
  reviews: boundedTaskCollection(WorkflowReviewSchema, 96),
  stageTasks: boundedTaskCollection(HiveWorkflowStageTaskSchema, WORKFLOW_STAGE_LIMITS.stages, 4),
  executionAvailability: z.discriminatedUnion('available', [
    z.strictObject({
      available: z.literal(false),
      reason: z.literal('EXECUTION_ISOLATION_UNAVAILABLE')
    }),
    z.strictObject({ available: z.literal(true), mode: z.literal('docker_linux') })
  ])
}).superRefine((view, context) => {
  const { binding, workflow, team } = view
  const scope = binding.scope
  const definition = workflow.definition
  if (
    invalidCaseSummary(view) ||
    binding.workflowRef !== workflow.workflowId ||
    binding.workflowRevision !== definition.workflowRevision ||
    view.definitionDigest !== workflow.definitionDigest ||
    scope.companyRef !== definition.scope.companyRef ||
    scope.projectRef !== definition.scope.projectRef ||
    scope.companyRef !== team.company.companyRef ||
    scope.projectRef !== team.project.scope.projectRef ||
    view.projectBindingRevision !== team.project.bindingRevision ||
    view.projectBindingRevision !== workflow.projectBindingRevision
  ) {
    context.addIssue({ code: 'custom', message: 'workflow_case_binding_mismatch' })
  }
  const stages = new Map(definition.stages.map((stage) => [stage.stageRef, stage]))
  const employees = new Map(team.employees.map((employee) => [employee.role, employee]))
  const taskIds = new Set(view.stageTasks.map((task) => task.taskId))
  const executionMatches = (
    stageRef: string,
    execution: z.infer<typeof WorkflowHandoffSchema>['producer']
  ) => {
    const task = view.stageTasks.find((item) => item.stageRef === stageRef)
    const stage = stages.get(stageRef)
    return (
      task?.employeeRef === execution.employeeRef &&
      task.role === execution.role &&
      task.taskId === execution.task.taskId &&
      execution.task.spaceId === scope.companyRef &&
      ObjectId.safeParse(execution.task.runId).success &&
      stage !== undefined &&
      execution.task.attempt <= stage.maxAttempts
    )
  }
  const handoffs = new Map(view.handoffs.map((item) => [item.handoffRef, item]))
  if (
    handoffs.size !== view.handoffs.length ||
    new Set(view.handoffs.map((item) => `${item.stageRef}:${item.producer.task.attempt}`)).size !==
      view.handoffs.length ||
    new Set(view.reviews.map((item) => item.reviewRef)).size !== view.reviews.length ||
    new Set(view.reviews.map((item) => item.reviewer.task.runId)).size !== view.reviews.length ||
    view.handoffs.some((handoff) => {
      const consumer = view.stageTasks.find((item) => item.stageRef === handoff.consumer.stageRef)
      return (
        digest(handoff.binding) !== digest(binding) ||
        !executionMatches(handoff.stageRef, handoff.producer) ||
        consumer?.role !== handoff.consumer.role ||
        consumer.employeeRef !== handoff.consumer.employeeRef ||
        handoff.audienceScope.employeeRefs.some(
          (ref) => !team.employees.some((employee) => employee.employeeRef === ref)
        ) ||
        handoff.dependencyVersions.some((dependency) => {
          const subject = handoffs.get(dependency.handoffRef)
          return (
            subject?.stageRef !== dependency.stageRef ||
            digest(subject.artifact) !== digest(dependency.artifact)
          )
        })
      )
    }) ||
    view.reviews.some((review) => {
      const subject = handoffs.get(review.subjectHandoffRef)
      return (
        digest(review.binding) !== digest(binding) ||
        !executionMatches(review.stageRef, review.reviewer) ||
        !subject ||
        subject.producer.role !== 'developer' ||
        digest(review.artifact) !== digest(subject.artifact) ||
        digest({ value: review.codeVersion }) !== digest({ value: subject.codeVersion })
      )
    })
  ) {
    context.addIssue({ code: 'custom', message: 'workflow_case_evidence_mismatch' })
  }
  if (
    view.stageTasks.length !== stages.size ||
    new Set(view.stageTasks.map((task) => task.stageRef)).size !== stages.size ||
    taskIds.size !== stages.size ||
    taskIds.has(view.originTaskId) ||
    view.stageTasks.some((task) => {
      const stage = stages.get(task.stageRef)
      const employee = employees.get(task.role)
      return (
        !stage ||
        stage.role !== task.role ||
        employee?.employeeRef !== task.employeeRef ||
        employee.profileRef !== 'codex' ||
        employee.profileRevision !== 'codex:1' ||
        employee.bindingRevision !== view.projectBindingRevision
      )
    })
  ) {
    context.addIssue({ code: 'custom', message: 'workflow_case_tasks_mismatch' })
  }
  if (
    view.terminalKind === null
      ? view.currentStageRef === null || !stages.has(view.currentStageRef)
      : view.currentStageRef !== null
  ) {
    context.addIssue({ code: 'custom', message: 'workflow_case_stage_mismatch' })
  }
  if (
    view.terminalKind === 'done'
      ? view.stageTasks.some((task) => task.status !== 'done')
      : view.terminalKind === 'cancelled' &&
        view.stageTasks.some((task) => task.status !== 'done' && task.status !== 'cancelled')
  ) {
    context.addIssue({ code: 'custom', message: 'workflow_case_terminal_mismatch' })
  }
})
export const HiveWorkflowCasePageSchema = z.strictObject({
  items: boundedTaskCollection(HiveWorkflowCaseSummarySchema, 50),
  nextCursor: ObjectId.nullable()
})
export const HiveWorkflowCaseCreateReplySchema = z
  .strictObject({
    admission: z.strictObject({
      requestId: ObjectId,
      caseId: ObjectId,
      payloadFingerprint: TaskDigest,
      replayed: z.boolean()
    }),
    view: HiveWorkflowCaseViewSchema
  })
  .superRefine((reply, context) => {
    if (reply.admission.caseId.toLowerCase() !== reply.view.id.toLowerCase()) {
      context.addIssue({ code: 'custom', message: 'workflow_case_admission_mismatch' })
    }
  })

export type HiveWorkflowCaseCreate = z.infer<typeof HiveWorkflowCaseCreateSchema>
export type HiveWorkflowCaseListQuery = z.input<typeof HiveWorkflowCaseListQuerySchema>
export type HiveWorkflowCaseReadQuery = z.infer<typeof HiveWorkflowCaseReadQuerySchema>
export type HiveWorkflowCaseSummary = z.infer<typeof HiveWorkflowCaseSummarySchema>
export type HiveWorkflowCaseView = z.infer<typeof HiveWorkflowCaseViewSchema>
export type HiveWorkflowCasePage = z.infer<typeof HiveWorkflowCasePageSchema>
export type HiveWorkflowCaseCreateReply = z.infer<typeof HiveWorkflowCaseCreateReplySchema>
export type HiveWorkflowCasesApi = {
  createWorkflowCase(input: HiveWorkflowCaseCreate): Promise<HiveWorkflowCaseView>
  listWorkflowCases(query: HiveWorkflowCaseListQuery): Promise<HiveWorkflowCasePage>
  getWorkflowCase(query: HiveWorkflowCaseReadQuery): Promise<HiveWorkflowCaseView>
}
