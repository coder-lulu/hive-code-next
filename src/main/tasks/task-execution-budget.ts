import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'
import { TaskTimestamp } from '../../shared/task-execution/task-execution-primitives'

type DeadlineCommand = Pick<TaskExecutionRecord['command'], 'executionDeadlineAt'>

export const TASK_EXECUTION_TIMEOUT_MS = 30 * 60_000

function commandDeadline(command?: DeadlineCommand): number {
  const deadline = command?.executionDeadlineAt
  if (deadline === undefined) {
    return Infinity
  }
  if (!TaskTimestamp.safeParse(deadline).success) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  return Date.parse(deadline)
}

export function assertTaskExecutionStartDeadlineCurrent(
  command: DeadlineCommand,
  now: number
): void {
  if (commandDeadline(command) <= now) {
    return refuseTaskExecution('FORBIDDEN')
  }
}

export function taskExecutionDeadline(
  record: Pick<TaskExecutionRecord, 'accepted'> & { command?: DeadlineCommand }
): number {
  const acceptedAt = Date.parse(record.accepted.recordedAt)
  if (
    !TaskTimestamp.safeParse(record.accepted.recordedAt).success ||
    !Number.isFinite(acceptedAt)
  ) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  return Math.min(acceptedAt + TASK_EXECUTION_TIMEOUT_MS, commandDeadline(record.command))
}
