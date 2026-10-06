import { isDeepStrictEqual } from 'node:util'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

export function assertTaskExecutionSnapshotCurrent(
  expected: TaskExecutionRecord,
  current: TaskExecutionRecord
): void {
  if (
    expected.commandFingerprint !== current.commandFingerprint ||
    expected.operationCallerKey !== current.operationCallerKey ||
    !isDeepStrictEqual(expected.command, current.command) ||
    !isDeepStrictEqual(expected.workspace, current.workspace)
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
}
