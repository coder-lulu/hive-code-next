export const TASK_EXECUTION_ERROR_CODES = [
  'INVALID_REQUEST',
  'CAPABILITY_UNAVAILABLE',
  'FORBIDDEN',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'WORKSPACE_BUSY',
  'TASK_BUSY',
  'OUTCOME_UNKNOWN',
  'EXECUTION_NOT_FOUND',
  'CAPACITY_EXCEEDED',
  'SERVICE_UNAVAILABLE'
] as const
export type TaskExecutionErrorCode = (typeof TASK_EXECUTION_ERROR_CODES)[number]

export class TaskExecutionError extends Error {
  constructor(readonly code: TaskExecutionErrorCode) {
    super(code)
  }
}

export function refuseTaskExecution(code: TaskExecutionErrorCode): never {
  throw new TaskExecutionError(code)
}
