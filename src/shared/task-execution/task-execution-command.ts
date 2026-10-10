import { z } from 'zod'
import { WorkflowExecutionContextSchema } from '../task-workflow/workflow-execution-context'
import {
  boundedTaskCollection,
  TaskDigest,
  TaskEpoch,
  TaskExecutionIdentity,
  TaskExecutionPolicySchema,
  TaskLaunchOperationId,
  TaskOpaqueRef,
  TaskOwnerScopeSchema,
  TaskRefSchema,
  TaskResourceRequirements,
  TaskTimestamp
} from './task-execution-primitives'

const StartFields = {
  ...TaskExecutionIdentity,
  kind: z.literal('execution.start'),
  task: TaskRefSchema,
  operationId: TaskLaunchOperationId,
  idempotencyKey: TaskOpaqueRef,
  agent: z.literal('hivecode'),
  profileId: TaskOpaqueRef,
  profileRevision: TaskOpaqueRef,
  policyRevision: TaskOpaqueRef,
  ownerScope: TaskOwnerScopeSchema,
  executionAccountRef: TaskOpaqueRef,
  billingSubjectRef: TaskOpaqueRef,
  workspaceRef: TaskOpaqueRef,
  workspaceExecutionClaimRef: TaskOpaqueRef,
  isolationPolicyRef: TaskOpaqueRef,
  writeFence: TaskEpoch,
  executionPolicy: TaskExecutionPolicySchema,
  inputRef: TaskOpaqueRef,
  authorizationRef: TaskOpaqueRef,
  authorizationRevision: TaskOpaqueRef,
  expiresAt: TaskTimestamp,
  executionDeadlineAt: TaskTimestamp.optional(),
  workflowContext: WorkflowExecutionContextSchema.optional(),
  requiredCapabilities: boundedTaskCollection(TaskOpaqueRef, 32)
}

// A partial snapshot must fail validation rather than become a static-resource launch.
export const TaskExecutionStartSchema = z
  .union([
    z.strictObject(StartFields),
    z.strictObject({ ...StartFields, ...TaskResourceRequirements })
  ])
  .superRefine((command, issue) => {
    const context = command.workflowContext
    if (!context) {
      return
    }
    if (
      command.executionPolicy.trustMode !== 'enforced_autonomous' ||
      command.executionDeadlineAt === undefined ||
      context.binding.scope.companyRef !== command.task.spaceId
    ) {
      issue.addIssue({ code: 'custom', message: 'workflow_controlled_admission_required' })
    }
    const plannedTask = context.planIntent?.sourceTask ?? context.planExecution?.sourceTask
    if (
      plannedTask &&
      (['spaceId', 'taskId', 'runId', 'attempt', 'taskRevision'] as const).some(
        (key) => plannedTask[key] !== command.task[key]
      )
    ) {
      issue.addIssue({ code: 'custom', message: 'workflow_plan_task_mismatch' })
    }
    const producer = context.codeInput?.producer
    if (
      context.role === 'tester' &&
      producer &&
      (producer.executionId === command.executionId ||
        producer.task.taskId === command.task.taskId ||
        producer.workspaceExecutionClaimRef === command.workspaceExecutionClaimRef)
    ) {
      issue.addIssue({ code: 'custom', message: 'workflow_independent_execution_required' })
    }
  })

export const TaskExecutionCancelSchema = z.strictObject({
  ...TaskExecutionIdentity,
  kind: z.literal('execution.cancel'),
  task: TaskRefSchema,
  idempotencyKey: TaskOpaqueRef,
  commandFingerprint: TaskDigest,
  authorizationRef: TaskOpaqueRef,
  authorizationRevision: TaskOpaqueRef,
  expiresAt: TaskTimestamp,
  reason: z.enum(['user_requested', 'authorization_revoked', 'budget_policy', 'shutdown'])
})

export type TaskExecutionStart = z.infer<typeof TaskExecutionStartSchema>
export type TaskExecutionCancel = z.infer<typeof TaskExecutionCancelSchema>
