import { z } from 'zod'
import {
  boundedTaskCollection,
  TaskCounter,
  TaskCoverage,
  TaskDigest,
  TaskExecutionIdentity,
  TaskExecutionStatus,
  TaskLaunchOperationId,
  TaskOpaqueRef,
  TaskProgressSummary,
  TaskTimestamp
} from './task-execution-primitives'

const ReceiptIdentity = {
  ...TaskExecutionIdentity,
  commandFingerprint: TaskDigest,
  recordedAt: TaskTimestamp
}

export const TaskExecutionAcceptedSchema = z.strictObject({
  ...ReceiptIdentity,
  kind: z.literal('execution.accepted'),
  receiptId: TaskOpaqueRef,
  status: z.literal('accepted'),
  operationId: TaskLaunchOperationId,
  workspaceExecutionClaimRef: TaskOpaqueRef,
  writeFence: TaskCounter.min(1)
})

export const TaskExecutionEventSchema = z.strictObject({
  ...ReceiptIdentity,
  kind: z.literal('execution.event'),
  eventId: TaskOpaqueRef,
  sequence: TaskCounter.min(1),
  status: TaskExecutionStatus,
  summary: TaskProgressSummary.optional(),
  artifactRefs: boundedTaskCollection(TaskOpaqueRef, 32)
})

export const TaskResourcePreparationSchema = z.strictObject({
  ...ReceiptIdentity,
  kind: z.literal('resource.preparation'),
  receiptId: TaskOpaqueRef,
  snapshotRef: TaskOpaqueRef,
  snapshotDigest: TaskDigest,
  resolverVersion: TaskOpaqueRef,
  status: z.enum(['waiting_resource', 'preparing', 'ready', 'resource_preparation_failed']),
  existingSkillReceiptRefs: boundedTaskCollection(TaskOpaqueRef, 256)
})

export const TaskResourceActivationSchema = z.strictObject({
  ...ReceiptIdentity,
  kind: z.literal('resource.activation'),
  receiptId: TaskOpaqueRef,
  sessionRef: TaskOpaqueRef,
  snapshotRef: TaskOpaqueRef,
  snapshotDigest: TaskDigest,
  resolverVersion: TaskOpaqueRef,
  observedCoverage: TaskCoverage,
  effectiveSetDigest: TaskDigest,
  loaderVersion: TaskOpaqueRef,
  loadedRefs: boundedTaskCollection(TaskOpaqueRef, 256)
})

export const TaskExecutionStopProofSchema = z.strictObject({
  proofRef: TaskOpaqueRef,
  evidenceKind: z.enum(['not_started', 'stopped']),
  managedToolsSettled: z.literal(true),
  writersFenced: z.literal(true),
  recordedAt: TaskTimestamp
})

const ResultFields = {
  ...ReceiptIdentity,
  kind: z.literal('execution.result'),
  receiptId: TaskOpaqueRef,
  outcomeRef: TaskOpaqueRef,
  artifactRefs: boundedTaskCollection(TaskOpaqueRef, 32),
  usageFactRefs: boundedTaskCollection(TaskOpaqueRef, 256)
}

export const TaskExecutionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...ResultFields,
    status: z.literal('succeeded'),
    stopProof: TaskExecutionStopProofSchema.extend({ evidenceKind: z.literal('stopped') })
  }),
  z.strictObject({
    ...ResultFields,
    status: z.literal('failed'),
    stopProof: TaskExecutionStopProofSchema
  }),
  z.strictObject({
    ...ResultFields,
    status: z.literal('cancelled'),
    stopProof: TaskExecutionStopProofSchema
  })
])

const UsageFields = {
  ...ReceiptIdentity,
  kind: z.literal('usage.fact'),
  eventId: TaskOpaqueRef,
  sourceRef: TaskOpaqueRef,
  sourceEventId: TaskOpaqueRef,
  sourceRevision: TaskCounter,
  requestId: TaskOpaqueRef.nullable(),
  sessionRef: TaskOpaqueRef.nullable(),
  usageBasis: z.enum(['per_run', 'session_cumulative', 'unknown']),
  inputTokens: TaskCounter.nullable(),
  outputTokens: TaskCounter.nullable(),
  cachedInputTokens: TaskCounter.nullable()
}

const UnknownCostFields = {
  ...UsageFields,
  costSource: z.literal('unknown'),
  costMicros: z.null(),
  currency: z.null()
}

const ConfirmedCostFields = {
  ...UsageFields,
  costSource: z.literal('authoritative_billing'),
  costMicros: TaskCounter,
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}(?![\s\S])/)
}

export const TaskUsageFactSchema = z.union([
  z.strictObject({ ...UnknownCostFields, usageBasis: z.enum(['per_run', 'unknown']) }),
  z.strictObject({
    ...UnknownCostFields,
    usageBasis: z.literal('session_cumulative'),
    sessionRef: TaskOpaqueRef
  }),
  z.strictObject({ ...ConfirmedCostFields, usageBasis: z.enum(['per_run', 'unknown']) }),
  z.strictObject({
    ...ConfirmedCostFields,
    usageBasis: z.literal('session_cumulative'),
    sessionRef: TaskOpaqueRef
  })
])

export type TaskExecutionResult = z.infer<typeof TaskExecutionResultSchema>
export type TaskResourceActivation = z.infer<typeof TaskResourceActivationSchema>
