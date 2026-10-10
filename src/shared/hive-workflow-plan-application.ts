import { z } from 'zod'
import { HiveWorkflowCaseReadQuerySchema, HiveWorkflowStageTaskSchema } from './hive-workflow-cases'
import { HiveWorkbenchObjectIdInputSchema } from './hive-team-workbench'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
import { workflowPlanApplicationMatchesDraft } from './hive-workflow-plan-application-source'
import {
  boundedTaskCollection,
  TaskCounter,
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef,
  TaskTimestamp
} from './task-execution/task-execution-primitives'
import { WorkflowRunBindingSchema } from './task-workflow/workflow-bindings'
import { WorkflowPlanDraftSchema } from './task-workflow/workflow-plan-draft'
import { compareWorkflowPlans, WorkflowPlanDiffSchema } from './task-workflow/workflow-plan-diff'

export const HIVE_WORKFLOW_PLAN_APPLY_OPERATION = 'plans.apply'
const ObjectId = z.string().uuid()
const CaseRevision = z.number().int().min(1).max(2_147_483_647)
export const HiveWorkflowPlanQuerySchema = HiveWorkflowCaseReadQuerySchema.extend({
  draftRef: TaskOpaqueRef
})
export const HiveWorkflowPlanApplySchema = HiveWorkflowPlanQuerySchema.extend({
  requestId: HiveWorkbenchObjectIdInputSchema,
  expectedCaseRevision: CaseRevision,
  expectedProjectRevision: TaskEpoch,
  planRevision: TaskEpoch,
  draftDigest: TaskDigest
})
export const HiveWorkflowPlanApplicationReceiptSchema = z
  .strictObject({
    contractVersion: z.literal(1),
    kind: z.literal('workflow.plan-application'),
    applicationRef: ObjectId,
    requestId: ObjectId,
    binding: WorkflowRunBindingSchema,
    planRevision: TaskEpoch,
    draftRef: TaskOpaqueRef,
    draftDigest: TaskDigest,
    proposalDigest: TaskDigest,
    projectBindingRevision: TaskEpoch,
    parentTaskRef: ObjectId,
    createdTaskRefs: boundedTaskCollection(
      z.strictObject({
        proposalTaskRef: TaskOpaqueRef,
        taskId: ObjectId,
        employeeRef: ObjectId,
        dependsOnTaskIds: boundedTaskCollection(ObjectId, 32)
      }),
      32,
      1
    ),
    appliedAt: TaskTimestamp,
    dispatch: z.strictObject({
      available: z.literal(false),
      reason: z.literal('task_graph_dispatch_unavailable')
    })
  })
  .superRefine((receipt, context) => {
    const tasks = receipt.createdTaskRefs
    const ids = new Set(tasks.map((task) => task.taskId))
    const reached = new Set<string>()
    for (let pass = 0; pass < tasks.length; pass++) {
      for (const task of tasks) {
        if (task.dependsOnTaskIds.every((id) => reached.has(id))) {
          reached.add(task.taskId)
        }
      }
    }
    if (
      ids.size !== tasks.length ||
      ids.has(receipt.parentTaskRef) ||
      reached.size !== tasks.length ||
      new Set(tasks.map((task) => task.proposalTaskRef)).size !== tasks.length ||
      tasks.some(
        (task) =>
          new Set(task.dependsOnTaskIds).size !== task.dependsOnTaskIds.length ||
          task.dependsOnTaskIds.some((id) => !ids.has(id))
      )
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_plan_application_mapping_invalid' })
    }
  })
export const HiveWorkflowPlanApplicationViewSchema = z
  .strictObject({
    caseId: ObjectId,
    projectId: ObjectId,
    caseRevision: CaseRevision,
    currentProjectBindingRevision: TaskEpoch,
    draft: WorkflowPlanDraftSchema,
    baseline: WorkflowPlanDraftSchema.nullable(),
    diff: WorkflowPlanDiffSchema.nullable(),
    eligibility: z.discriminatedUnion('available', [
      z.strictObject({ available: z.literal(true) }),
      z.strictObject({
        available: z.literal(false),
        reason: z.enum([
          'draft_rejected',
          'draft_unavailable',
          'plan_not_current',
          'case_cancelled',
          'case_busy',
          'project_binding_changed',
          'role_unavailable',
          'already_applied',
          'plan_replacement_unavailable'
        ])
      })
    ]),
    application: HiveWorkflowPlanApplicationReceiptSchema.nullable(),
    taskStates: boundedTaskCollection(
      z.strictObject({
        taskId: ObjectId,
        status: HiveWorkflowStageTaskSchema.shape.status,
        taskRevision: TaskCounter
      }),
      32
    )
  })
  .superRefine((view, context) => {
    const reject = (message: string) => context.addIssue({ code: 'custom', message })
    const { draft, baseline, application } = view
    const facts = draft.intent.facts
    if (
      facts.binding.workflowRunRef !== view.caseId ||
      facts.binding.scope.projectRef !== view.projectId
    ) {
      reject('workflow_plan_application_case_mismatch')
    }
    if (
      baseline &&
      (baseline.inspection.kind !== 'validated' ||
        digest(baseline.intent.facts.binding) !== digest(facts.binding) ||
        baseline.intent.facts.goalRef !== facts.goalRef ||
        baseline.intent.facts.definitionDigest !== facts.definitionDigest ||
        baseline.intent.facts.planRevision >= facts.planRevision ||
        baseline.draftRef === draft.draftRef)
    ) {
      reject('workflow_plan_application_baseline_mismatch')
    }
    if (
      draft.inspection.kind === 'validated' &&
      (!baseline || baseline.inspection.kind === 'validated')
    ) {
      try {
        const expected = compareWorkflowPlans(
          draft.inspection.proposal,
          baseline?.inspection.kind === 'validated' ? baseline.inspection.proposal : null
        )
        if (digest(expected) !== digest(view.diff ?? {})) {
          reject('workflow_plan_application_diff_mismatch')
        }
      } catch {
        reject('workflow_plan_application_diff_mismatch')
      }
    } else if (view.diff !== null) {
      reject('workflow_plan_application_diff_mismatch')
    }
    if (
      view.eligibility.available &&
      (draft.inspection.kind !== 'validated' || application !== null)
    ) {
      reject('workflow_plan_application_eligibility_mismatch')
    }
    if (application) {
      if (
        digest(application.binding) !== digest(facts.binding) ||
        application.parentTaskRef !== facts.goalRef
      ) {
        reject('workflow_plan_application_binding_mismatch')
      }
      if (
        application.draftRef === draft.draftRef &&
        !workflowPlanApplicationMatchesDraft(application, draft)
      ) {
        reject('workflow_plan_application_source_mismatch')
      }
    }
    const expectedIds = application?.createdTaskRefs.map((task) => task.taskId).sort() ?? []
    if (
      digest({ ids: view.taskStates.map((task) => task.taskId).sort() }) !==
      digest({ ids: expectedIds })
    ) {
      reject('workflow_plan_application_task_states_mismatch')
    }
  })
export const HiveWorkflowPlanApplyReplySchema = z
  .strictObject({
    admission: z.strictObject({
      requestId: ObjectId,
      payloadFingerprint: TaskDigest,
      replayed: z.boolean()
    }),
    view: HiveWorkflowPlanApplicationViewSchema
  })
  .superRefine((reply, context) => {
    if (
      !reply.view.application ||
      (!reply.admission.replayed && reply.view.application.requestId !== reply.admission.requestId)
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_plan_application_admission_mismatch' })
    }
  })
export type HiveWorkflowPlanQuery = z.infer<typeof HiveWorkflowPlanQuerySchema>
export type HiveWorkflowPlanApply = z.infer<typeof HiveWorkflowPlanApplySchema>
export type HiveWorkflowPlanApplicationReceipt = z.infer<
  typeof HiveWorkflowPlanApplicationReceiptSchema
>
export type HiveWorkflowPlanApplicationView = z.infer<typeof HiveWorkflowPlanApplicationViewSchema>
export type HiveWorkflowPlanApplyReply = z.infer<typeof HiveWorkflowPlanApplyReplySchema>
export type HiveWorkflowPlansApi = {
  getWorkflowPlanApplication(query: HiveWorkflowPlanQuery): Promise<HiveWorkflowPlanApplicationView>
  applyWorkflowPlan(input: HiveWorkflowPlanApply): Promise<HiveWorkflowPlanApplyReply>
}
