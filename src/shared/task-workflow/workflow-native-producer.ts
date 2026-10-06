import { z } from 'zod'
import {
  TaskExecutionIdentity,
  TaskDigest,
  TaskLaunchOperationId,
  TaskOpaqueRef,
  TaskOwnerScopeSchema,
  TaskRefSchema,
  TaskEpoch
} from '../task-execution/task-execution-primitives'

export const WorkflowNativeProducerSchema = z.strictObject({
  ...TaskExecutionIdentity,
  task: TaskRefSchema,
  commandFingerprint: TaskDigest,
  operationId: TaskLaunchOperationId,
  operationCallerKey: TaskOpaqueRef,
  ownerScope: TaskOwnerScopeSchema,
  executionAccountRef: TaskOpaqueRef,
  workspaceRef: TaskOpaqueRef,
  executionWorkspaceId: z.string().min(1).max(512),
  workspaceExecutionClaimRef: TaskOpaqueRef,
  writeFence: TaskEpoch,
  sessionRef: z.string().min(1).max(160).nullable(),
  status: z.enum(['succeeded', 'failed']),
  outcomeRef: TaskOpaqueRef,
  resultDigest: TaskDigest
})
export type WorkflowNativeProducer = z.infer<typeof WorkflowNativeProducerSchema>
