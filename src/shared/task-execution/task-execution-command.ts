import { z } from 'zod'
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
  requiredCapabilities: boundedTaskCollection(TaskOpaqueRef, 32)
}

// A partial snapshot must fail validation rather than become a static-resource launch.
export const TaskExecutionStartSchema = z.union([
  z.strictObject(StartFields),
  z.strictObject({ ...StartFields, ...TaskResourceRequirements })
])

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
