import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

export const TASK_EXECUTION_TIMEOUT_MS = 30 * 60_000

export function taskExecutionDeadline(record: Pick<TaskExecutionRecord, 'accepted'>): number {
  const acceptedAt = Date.parse(record.accepted.recordedAt)
  if (!Number.isFinite(acceptedAt)) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  return acceptedAt + TASK_EXECUTION_TIMEOUT_MS
}
