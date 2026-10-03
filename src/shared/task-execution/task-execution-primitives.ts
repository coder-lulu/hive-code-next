import { z } from 'zod'

export const TASK_EXECUTION_PROTOCOL_VERSION = 1
export const TASK_EXECUTION_CAPABILITY = 'task.execution.v1'
export const TASK_WORKSPACE_CLAIM_CAPABILITY = 'task.workspace-claim.v1'
export const TASK_STOP_PROOF_CAPABILITY = 'task.stop-proof.v1'
export const TASK_RESOURCE_SNAPSHOT_CAPABILITY = 'task.resource-snapshot.v1'
export const TASK_ENFORCEMENT_CAPABILITY = 'task.enforcement.v1'

export const TaskOpaqueRef = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}(?![\s\S])/)
export const TaskDigest = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}(?![\s\S])/)
export const TaskLaunchOperationId = z
  .string()
  .length(46)
  .regex(/^[0-9]{13}-[0-9a-f]{32}(?![\s\S])/)
export const TaskCounter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const TaskEpoch = TaskCounter.min(1)
// Keep calendar validation and constrain digits across non-ECMAScript schema validators.
export const TaskTimestamp = z.iso
  .datetime({ precision: 3 })
  .length(24)
  .regex(/^[0-9TZ:.-]{24}(?![\s\S])/)
export const TaskCoverage = z.enum(['managed_only', 'effective_set_verified'])
// Count Unicode characters consistently with JSON Schema and reject broken surrogate pairs.
export const TaskProgressSummary = z
  .string()
  .max(4096)
  .regex(/^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF]){0,2048}(?![\s\S])/)

export function boundedTaskCollection<Item extends z.ZodType>(
  item: Item,
  maximum: number,
  minimum?: number
) {
  const collection = z.array(item).max(maximum)
  return z.preprocess(
    (value, context) => {
      if (Array.isArray(value) && value.length > maximum) {
        context.addIssue({ code: 'custom', message: 'Task collection exceeds its item limit.' })
        return z.NEVER
      }
      return value
    },
    minimum === undefined ? collection : collection.min(minimum)
  )
}

export const TaskExecutionStatus = z.enum([
  'accepted',
  'running',
  'waiting_input',
  'cancel_requested',
  'outcome_unknown',
  'succeeded',
  'failed',
  'cancelled'
])

export const TaskRefSchema = z.strictObject({
  spaceId: TaskOpaqueRef,
  taskId: TaskOpaqueRef,
  runId: TaskOpaqueRef,
  attempt: TaskEpoch,
  taskRevision: TaskOpaqueRef
})

export const TaskOwnerScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('personalTenant'), tenantRef: TaskOpaqueRef }),
  z.strictObject({ kind: z.literal('teamSpace'), teamSpaceRef: TaskOpaqueRef })
])

export const TaskRuntimeIdentity = {
  protocolVersion: z.literal(TASK_EXECUTION_PROTOCOL_VERSION),
  runtimeRecordId: TaskOpaqueRef,
  ownershipEpoch: TaskEpoch
}

export const TaskExecutionIdentity = {
  ...TaskRuntimeIdentity,
  executionId: TaskOpaqueRef,
  executionEpoch: TaskEpoch
}

export const TaskExecutionPolicySchema = z.discriminatedUnion('trustMode', [
  z.strictObject({
    trustMode: z.literal('trusted_personal_preview'),
    executionPolicyRef: TaskOpaqueRef,
    executionPolicyRevision: TaskOpaqueRef
  }),
  z.strictObject({
    trustMode: z.literal('enforced_autonomous'),
    executionPolicyRef: TaskOpaqueRef,
    executionPolicyRevision: TaskOpaqueRef,
    enforcementEvidenceRef: TaskOpaqueRef
  })
])

export const TaskResourceRequirements = {
  resourceSnapshotRef: TaskOpaqueRef,
  resourceSnapshotDigest: TaskDigest,
  manifestVersion: TaskOpaqueRef,
  resolverVersion: TaskOpaqueRef,
  requiredCoverage: TaskCoverage,
  resourceScopeRef: TaskOpaqueRef
}

export type TaskRef = z.infer<typeof TaskRefSchema>
export type TaskExecutionState = z.infer<typeof TaskExecutionStatus>
