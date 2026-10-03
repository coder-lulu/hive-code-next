import { z } from 'zod'
import {
  boundedTaskCollection,
  TaskCounter,
  TaskDigest,
  TaskExecutionIdentity,
  TaskExecutionStatus,
  TaskOpaqueRef,
  TaskTimestamp
} from './task-execution-primitives'
import {
  TaskExecutionAcceptedSchema,
  TaskExecutionEventSchema,
  TaskExecutionResultSchema
} from './task-execution-receipts'

const QueryFields = {
  ...TaskExecutionIdentity,
  commandFingerprint: TaskDigest,
  authorizationRef: TaskOpaqueRef,
  authorizationRevision: TaskOpaqueRef,
  expiresAt: TaskTimestamp
}

export const TaskExecutionObserveSchema = z.strictObject({
  ...QueryFields,
  kind: z.literal('execution.observe'),
  afterSequence: TaskCounter,
  limit: TaskCounter.min(1).max(32)
})

export const TaskExecutionReconcileSchema = z.strictObject({
  ...QueryFields,
  kind: z.literal('execution.reconcile')
})

export const TaskExecutionObservationSchema = z
  .strictObject({
    ...TaskExecutionIdentity,
    kind: z.literal('execution.observation'),
    commandFingerprint: TaskDigest,
    status: TaskExecutionStatus,
    accepted: TaskExecutionAcceptedSchema,
    events: boundedTaskCollection(TaskExecutionEventSchema, 32),
    cursor: TaskCounter,
    lastSequence: TaskCounter.min(1),
    sessionRef: TaskOpaqueRef.nullable(),
    result: TaskExecutionResultSchema.nullable()
  })
  .superRefine((observation, context) => {
    const receipts = [
      observation.accepted,
      ...observation.events,
      ...(observation.result ? [observation.result] : [])
    ]
    const lastEvent = observation.events.at(-1)
    const terminal = ['succeeded', 'failed', 'cancelled'].includes(observation.status)
    if (
      receipts.some(
        (receipt) =>
          receipt.protocolVersion !== observation.protocolVersion ||
          receipt.runtimeRecordId !== observation.runtimeRecordId ||
          receipt.ownershipEpoch !== observation.ownershipEpoch ||
          receipt.executionId !== observation.executionId ||
          receipt.executionEpoch !== observation.executionEpoch ||
          receipt.commandFingerprint !== observation.commandFingerprint
      ) ||
      observation.cursor > observation.lastSequence ||
      (lastEvent && lastEvent.sequence !== observation.cursor) ||
      observation.events.some(
        (event, index) =>
          event.sequence > observation.lastSequence ||
          (index > 0 && event.sequence !== observation.events[index - 1].sequence + 1)
      ) ||
      (lastEvent &&
        observation.cursor === observation.lastSequence &&
        lastEvent.status !== observation.status) ||
      terminal !== (observation.result !== null) ||
      (observation.result && observation.result.status !== observation.status)
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid task observation binding or cursor.' })
    }
  })

export type TaskExecutionObserve = z.infer<typeof TaskExecutionObserveSchema>
export type TaskExecutionObservation = z.infer<typeof TaskExecutionObservationSchema>
