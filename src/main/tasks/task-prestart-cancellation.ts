import {
  TaskExecutionStartSchema,
  type TaskExecutionCancel
} from '../../shared/task-execution/task-execution-command'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import { taskExecutionCapabilityRefusal } from '../../shared/task-execution/task-execution-capabilities'
import type { TaskExecutionCaller, TaskExecutionHostDependencies } from './task-execution-ports'
import { refuseTaskExecution } from './task-execution-error'

/** Admit a trusted, cancelled execution without ever invoking its launch port. */
export async function admitTaskPrestartCancellation(
  command: TaskExecutionCancel,
  caller: TaskExecutionCaller,
  deps: TaskExecutionHostDependencies,
  authorize: TaskExecutionHostDependencies['authorize'],
  now: number
) {
  if (deps.store.get(command)) {
    return
  }
  const original = deps.resolveStart?.(command)
  if (!original) {
    return refuseTaskExecution('EXECUTION_NOT_FOUND')
  }
  const start = TaskExecutionStartSchema.parse({
    ...original,
    authorizationRef: command.authorizationRef,
    authorizationRevision: command.authorizationRevision,
    expiresAt: command.expiresAt
  })
  if (
    start.runtimeRecordId !== command.runtimeRecordId ||
    start.ownershipEpoch !== command.ownershipEpoch ||
    start.executionId !== command.executionId ||
    start.executionEpoch !== command.executionEpoch ||
    computeTaskExecutionFingerprint(start, caller.operationCallerKey) !==
      command.commandFingerprint ||
    JSON.stringify(start.task) !== JSON.stringify(command.task)
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  const grant = await authorize(caller, start, 'cancel')
  if (taskExecutionCapabilityRefusal(start, deps.capabilities())) {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  await deps.store.admit({
    command: start,
    operationCallerKey: caller.operationCallerKey,
    workspace: grant.workspace,
    now,
    validate: grant.assertCurrent
  })
}
