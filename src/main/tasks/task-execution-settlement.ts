import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  boundedTaskCollection,
  TaskOpaqueRef
} from '../../shared/task-execution/task-execution-primitives'
import { settleBeforeDeadline } from '../runtime/settle-before-deadline'
import { TaskExecutionError } from './task-execution-error'
import { taskExecutionIdentity, type TaskExecutionRecord } from './task-execution-record'
import type {
  TaskExecutionHostDependencies,
  TaskExecutionStopEvidence
} from './task-execution-ports'

const Candidate = z.strictObject({
  outcomeRef: TaskOpaqueRef,
  artifactRefs: boundedTaskCollection(TaskOpaqueRef, 32),
  status: z.enum(['succeeded', 'failed']).optional()
})

function proofMatches(record: TaskExecutionRecord, proof: TaskExecutionStopEvidence) {
  return (
    proof.runtimeRecordId === record.command.runtimeRecordId &&
    proof.ownershipEpoch === record.command.ownershipEpoch &&
    proof.executionId === record.command.executionId &&
    proof.executionEpoch === record.command.executionEpoch &&
    proof.commandFingerprint === record.commandFingerprint &&
    proof.workspaceExecutionClaimRef === record.command.workspaceExecutionClaimRef &&
    proof.writeFence === record.command.writeFence &&
    proof.operationId === record.command.operationId &&
    proof.operationCallerKey === record.operationCallerKey &&
    proof.managedToolsSettled === true &&
    proof.writersFenced === true &&
    (proof.evidenceKind === 'stopped' ||
      (proof.evidenceKind === 'not_started' && record.dispatch === 'not_dispatched'))
  )
}

/** Refresh cancellation after I/O, then select the terminal outcome under the store lock. */
export async function collectTaskExecutionSettlement(
  deps: TaskExecutionHostDependencies,
  initial: TaskExecutionRecord,
  pendingLaunch: Promise<void> | undefined,
  now: () => number,
  validate: () => void = () => undefined
) {
  const deadline = Date.now() + (deps.evidenceTimeoutMs ?? 5000)
  if (pendingLaunch) {
    await settleBeforeDeadline(() => pendingLaunch, undefined, deadline)
  }
  let record = deps.store.get(initial.command)
  if (!record || record.result) {
    return
  }
  validate()
  let rawCandidate: unknown = null
  let readFailed = false
  if (!record.cancellationKey) {
    const collecting = record
    try {
      rawCandidate = await settleBeforeDeadline(
        () => deps.collect(collecting),
        null,
        deadline,
        new TaskExecutionError('OUTCOME_UNKNOWN')
      )
    } catch {
      readFailed = true
    }
  }
  record = deps.store.get(initial.command)
  if (!record || record.result) {
    return
  }
  const candidate = Candidate.safeParse(rawCandidate)
  if (!record.cancellationKey && (readFailed || (rawCandidate !== null && !candidate.success))) {
    await deps.store.markUnknown(record.command, now(), validate)
    return
  }
  if (!record.cancellationKey && !candidate.success) {
    return
  }
  const stopping = record
  validate()
  const proof = await settleBeforeDeadline(() => deps.stop(stopping), null, deadline)
  if (!proof || !proofMatches(record, proof)) {
    await deps.store.markUnknown(record.command, now(), validate)
    return
  }
  const current = deps.store.get(record.command)
  if (!current || current.result) {
    return
  }
  if (!current.cancellationKey && proof.evidenceKind !== 'stopped') {
    await deps.store.markUnknown(record.command, now(), validate)
    return
  }
  const succeeded = candidate.success ? candidate.data : null
  await deps.store.settle(
    record.command,
    (latest) => {
      validate()
      if (!latest.cancellationKey && !succeeded) {
        throw new TaskExecutionError('OUTCOME_UNKNOWN')
      }
      const recordedAt = new Date(now()).toISOString()
      const common = {
        ...taskExecutionIdentity(latest.command),
        commandFingerprint: latest.commandFingerprint,
        recordedAt,
        kind: 'execution.result' as const,
        receiptId: `result:${randomUUID()}`,
        outcomeRef: latest.cancellationKey ? `cancel:${randomUUID()}` : succeeded!.outcomeRef,
        artifactRefs: latest.cancellationKey ? [] : succeeded!.artifactRefs,
        usageFactRefs: [],
        stopProof: {
          proofRef: `stop:${randomUUID()}`,
          evidenceKind: proof.evidenceKind,
          managedToolsSettled: true as const,
          writersFenced: true as const,
          recordedAt
        }
      }
      return latest.cancellationKey
        ? { ...common, status: 'cancelled' }
        : {
            ...common,
            status: succeeded!.status ?? 'succeeded',
            stopProof: { ...common.stopProof, evidenceKind: 'stopped' }
          }
    },
    now()
  )
}
