import { z } from 'zod'
import {
  TaskCounter,
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef,
  TaskTimestamp
} from './task-execution-primitives'

export const TaskDeliveryTokenSchema = z.strictObject({
  ownerId: TaskOpaqueRef,
  leaseRef: TaskOpaqueRef,
  generation: TaskCounter.min(1)
})
export type TaskDeliveryToken = z.infer<typeof TaskDeliveryTokenSchema>

export const TaskDeliveryProofSchema = TaskDeliveryTokenSchema.extend({
  accountId: z.string().min(1).max(512),
  companyId: z.string().uuid(),
  taskId: z.string().uuid(),
  runId: z.string().uuid(),
  protocolVersion: z.literal(1),
  runtimeRecordId: TaskOpaqueRef,
  ownershipEpoch: TaskEpoch,
  executionId: TaskOpaqueRef,
  executionEpoch: TaskEpoch,
  commandFingerprint: TaskDigest,
  operationId: TaskOpaqueRef,
  workspaceExecutionClaimRef: TaskOpaqueRef,
  writeFence: TaskEpoch,
  cursor: TaskCounter,
  serverNow: TaskTimestamp,
  expiresAt: TaskTimestamp
})
export type TaskDeliveryProof = z.infer<typeof TaskDeliveryProofSchema>

export const LocalTaskRuntimeOwnerSchema = z.strictObject({
  accountId: z.string().min(1).max(512),
  runtimeRecordId: TaskOpaqueRef,
  ownershipEpoch: TaskEpoch
})
