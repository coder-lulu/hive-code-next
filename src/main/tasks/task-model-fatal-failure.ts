import { isDeepStrictEqual as same } from 'node:util'
import type { TaskExecutionPersistence } from './task-execution-store'
import { assertTaskExecutionSnapshotCurrent } from './task-execution-snapshot-guard'
import { taskExecutionRecordKey, type TaskExecutionRecord } from './task-execution-record'
import { taskFailure, type TaskFailureError } from './task-failure-diagnostic'
import { refuseTaskExecution } from './task-execution-error'

type Fact = { snapshot: TaskExecutionRecord; failure: TaskFailureError }
const facts = new WeakMap<TaskExecutionPersistence, Map<string, Fact>>()

/** Private original channel fact; durable event prose cannot reconstruct it after restart. */
export function retainTaskModelFatalFailure(
  store: TaskExecutionPersistence,
  snapshot: TaskExecutionRecord,
  failure: TaskFailureError
) {
  if (
    taskFailure(failure, 'channel', 'OUTCOME_UNKNOWN') !== failure ||
    failure.diagnostic.phase !== 'stream' ||
    failure.diagnostic.httpStatus !== 200 ||
    snapshot.cancellationKey ||
    snapshot.result ||
    !snapshot.modelDispatchAttempts
  ) {
    return
  }
  let original = facts.get(store)
  if (!original) {
    original = new Map()
    facts.set(store, original)
  }
  for (const [key, fact] of original) {
    const current = store.get(fact.snapshot.command)
    if (!current || current.result) {
      original.delete(key)
    }
  }
  const key = taskExecutionRecordKey(snapshot.command)
  if (!original.has(key)) {
    original.set(key, { snapshot: structuredClone(snapshot), failure })
  }
}

export function readTaskModelFatalFailure(
  store: TaskExecutionPersistence,
  record: TaskExecutionRecord
): TaskFailureError | undefined {
  const key = taskExecutionRecordKey(record.command)
  const original = facts.get(store)
  const fact = original?.get(key)
  if (!fact) {
    return
  }
  if (record.result) {
    original?.delete(key)
    return
  }
  assertTaskExecutionSnapshotCurrent(fact.snapshot, record)
  if (
    !same(fact.snapshot.structuredBinding, record.structuredBinding) ||
    !same(fact.snapshot.dockerIdentity, record.dockerIdentity) ||
    !record.modelDispatchAttempts ||
    !['bound', 'dispatching'].includes(record.dispatch)
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  return fact.failure
}

export function forgetTaskModelFatalFailure(
  store: TaskExecutionPersistence,
  record: TaskExecutionRecord
) {
  if (record.result) {
    facts.get(store)?.delete(taskExecutionRecordKey(record.command))
  }
}
