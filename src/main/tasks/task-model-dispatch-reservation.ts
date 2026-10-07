import type { AgentSessionStoreTransactions } from '../runtime/agent-session-store-transactions'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import {
  TaskStructuredBindingSchema,
  type TaskStructuredBinding
} from '../../shared/task-execution/task-structured-binding'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import { refuseTaskExecution } from './task-execution-error'
import {
  TaskExecutionRecordSchema,
  taskExecutionRecordKey,
  type TaskExecutionRecord
} from './task-execution-record'
import { TASK_MODEL_REQUEST_LIMIT } from './task-model-channel-protocol'
import { assertTaskCodexSessionBinding } from './task-codex-session-binding'

/** Called only after the current Host grant passes inside the original Task update. */
export function reserveTaskModelDispatch(
  state: AgentSessionStoreState,
  task: TaskExecutionRecord,
  binding: TaskStructuredBinding
): TaskExecutionRecord {
  assertTaskModelDispatchCurrent(state, task, binding)
  const attempts = task.modelDispatchAttempts ?? 0
  if (attempts >= TASK_MODEL_REQUEST_LIMIT) {
    return refuseTaskExecution('CAPACITY_EXCEEDED')
  }
  return { ...task, modelDispatchAttempts: attempts + 1 }
}

export function assertTaskModelDispatchCurrent(
  state: AgentSessionStoreState,
  task: TaskExecutionRecord,
  binding: TaskStructuredBinding
): void {
  if (!TaskExecutionRecordSchema.safeParse(task).success) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  assertTaskCodexSessionBinding(state, task, binding)
}

export function runTaskModelEffect<T>(
  transactions: AgentSessionStoreTransactions,
  binding: TaskStructuredBinding,
  validate: () => void,
  start: () => T
) {
  const snapshot = TaskStructuredBindingSchema.safeParse(binding)
  if (!snapshot.success || typeof validate !== 'function' || typeof start !== 'function') {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  return transactions.transact((draft) => {
    assertTaskAuthorizationCurrent(() => validate())
    const task = draft.taskExecutions?.get(taskExecutionRecordKey(snapshot.data.source))
    if (!task) {
      return refuseTaskExecution('EXECUTION_NOT_FOUND')
    }
    assertTaskModelDispatchCurrent(draft, task, snapshot.data)
    if (!task.modelDispatchAttempts) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    // The envelope keeps the file transaction independent of a network promise.
    return { value: start() }
  })
}
