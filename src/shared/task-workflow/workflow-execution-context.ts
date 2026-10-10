import { z } from 'zod'
import {
  boundedTaskCollection,
  TaskDigest,
  TaskOpaqueRef
} from '../task-execution/task-execution-primitives'
import { WorkflowRoleSchema, WorkflowRunBindingSchema } from './workflow-bindings'
import { WorkflowCodeVersionSchema, WorkflowRoleExecutionSchema } from './workflow-evidence'
import { WorkflowPlanIntentSchema } from './workflow-plan-intent'
import { WorkflowPlanExecutionSchema } from './workflow-plan-execution'
import { structuredAgentSessionDigest as digest } from '../structured-agent-session-mutation'

// Immutable business references; only the authenticated host grant supplies execution authority.
export const WorkflowExecutionContextSchema = z
  .strictObject({
    kind: z.literal('workflow.execution-context'),
    binding: WorkflowRunBindingSchema,
    definitionDigest: TaskDigest,
    stageRef: TaskOpaqueRef,
    employeeRef: TaskOpaqueRef,
    role: WorkflowRoleSchema,
    handoffRefs: boundedTaskCollection(TaskOpaqueRef, 32),
    planIntent: WorkflowPlanIntentSchema.optional(),
    planExecution: WorkflowPlanExecutionSchema.optional(),
    codeInput: z
      .strictObject({
        producer: WorkflowRoleExecutionSchema,
        version: WorkflowCodeVersionSchema
      })
      .optional()
  })
  .superRefine((context, issue) => {
    const source = context.codeInput
    const intent = context.planIntent
    const plan = context.planExecution
    if (
      plan &&
      (intent ||
        plan.proposalTaskRef !== context.stageRef ||
        plan.sourceTask.spaceId !== context.binding.scope.companyRef)
    ) {
      issue.addIssue({ code: 'custom', message: 'workflow_execution_plan_mismatch' })
    }
    if (
      intent &&
      (context.role !== 'product' ||
        digest(intent.facts.binding) !== digest(context.binding) ||
        intent.facts.definitionDigest !== context.definitionDigest ||
        intent.stageRef !== context.stageRef ||
        intent.employeeRef !== context.employeeRef)
    ) {
      issue.addIssue({ code: 'custom', message: 'workflow_execution_plan_intent_mismatch' })
    }
    if (
      new Set(context.handoffRefs).size !== context.handoffRefs.length ||
      (source && source.producer.task.spaceId !== context.binding.scope.companyRef)
    ) {
      issue.addIssue({ code: 'custom', message: 'workflow_execution_source_mismatch' })
    }
    if (
      context.role === 'tester' &&
      (!source ||
        source.version.kind !== 'snapshot' ||
        source.producer.role !== 'developer' ||
        source.producer.employeeRef === context.employeeRef)
    ) {
      issue.addIssue({ code: 'custom', message: 'workflow_fixed_independent_test_required' })
    }
  })

export type WorkflowExecutionContext = z.infer<typeof WorkflowExecutionContextSchema>
