import { z } from 'zod'
import { TaskOpaqueRef, TaskRefSchema } from '../task-execution/task-execution-primitives'
import { WORKFLOW_CONTRACT_VERSION } from './workflow-bindings'
import { WorkflowPlanValidationFactsSchema } from './workflow-plan-validation'

// Frozen planning inputs describe the original server admission, never an execution grant.
export const WorkflowPlanIntentSchema = z
  .strictObject({
    contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
    kind: z.literal('workflow.plan-intent'),
    intentRef: TaskOpaqueRef,
    sourceTask: TaskRefSchema,
    stageRef: TaskOpaqueRef,
    employeeRef: TaskOpaqueRef,
    policyRef: z.literal('workflow.plan-inspection'),
    policyRevision: z.literal(1),
    facts: WorkflowPlanValidationFactsSchema
  })
  .superRefine((intent, context) => {
    if (intent.sourceTask.spaceId !== intent.facts.binding.scope.companyRef) {
      context.addIssue({ code: 'custom', message: 'workflow_plan_intent_source_mismatch' })
    }
  })

export type WorkflowPlanIntent = z.infer<typeof WorkflowPlanIntentSchema>
