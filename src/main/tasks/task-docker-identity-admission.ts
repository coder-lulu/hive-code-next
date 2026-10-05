import { isDeepStrictEqual } from 'node:util'
import {
  TaskDockerIdentitySchema,
  taskDockerIdentityMatchesRecord,
  type TaskDockerIdentity
} from './task-docker-identity'
import { refuseTaskExecution } from './task-execution-error'
import type { TaskExecutionRecord } from './task-execution-record'

export function admitTaskDockerIdentity(
  record: TaskExecutionRecord,
  identity: TaskDockerIdentity
): TaskExecutionRecord | null {
  const parsed = TaskDockerIdentitySchema.safeParse(identity)
  if (!parsed.success) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  const next = parsed.data
  if (!taskDockerIdentityMatchesRecord(next, record)) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  const current = record.dockerIdentity
  if (!current) {
    if (next.containerId !== null) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    return { ...record, dockerIdentity: next }
  }
  if (isDeepStrictEqual(current, next)) {
    return null
  }
  if (
    current.containerId !== null ||
    next.containerId === null ||
    !isDeepStrictEqual({ ...current, containerId: null }, { ...next, containerId: null })
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  return { ...record, dockerIdentity: next }
}
