import { isDeepStrictEqual as same } from 'node:util'
import { agentSessionLeaseAdmitsWriter } from '../../shared/agent-session-lease-adjudication'
import { isAgentSessionRecord } from '../../shared/agent-session-record'
import {
  taskSessionSourceReference,
  type TaskStructuredBinding
} from '../../shared/task-execution/task-structured-binding'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import { refuseTaskExecution } from './task-execution-error'
import { TaskExecutionRecordSchema, type TaskExecutionRecord } from './task-execution-record'
import { TASK_MODEL_REQUEST_LIMIT } from './task-model-channel-protocol'

/** Called only after the current Host grant passes inside the original Task update. */
export function reserveTaskModelDispatch(
  state: AgentSessionStoreState,
  task: TaskExecutionRecord,
  binding: TaskStructuredBinding
): TaskExecutionRecord {
  if (!TaskExecutionRecordSchema.safeParse(task).success) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  if (
    !same(task.structuredBinding, binding) ||
    !same(taskSessionSourceReference(task), binding.source)
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  if (
    state.taskRecoveryBlocked ||
    task.cancellationKey !== null ||
    task.result !== null ||
    !(
      (task.status === 'accepted' && task.dispatch === 'dispatching') ||
      (task.status === 'running' && task.dispatch === 'bound')
    )
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const session = state.records.get(binding.sessionId)
  if (!session) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  if (!isAgentSessionRecord(session)) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  if (
    state.hostId !== 'local' ||
    session.sessionId !== binding.sessionId ||
    session.provider !== 'codex' ||
    !same(session.taskSource, binding.source) ||
    !same(session.accountHome, binding.accountHome) ||
    !same(session.location, binding.location)
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  const lease = session.lease
  const owner = lease.ownerProcess
  if (!agentSessionLeaseAdmitsWriter(lease) || lease.deathEvidence !== null || !owner) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  if (
    lease.runtimeKind !== 'native' ||
    lease.sessionId !== binding.sessionId ||
    lease.runtimeFence !== binding.runtimeFence ||
    lease.reservedSpawnToken !== binding.spawnToken ||
    owner.spawnToken !== binding.spawnToken ||
    owner.hostId !== state.hostId
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  const attempts = task.modelDispatchAttempts ?? 0
  if (attempts >= TASK_MODEL_REQUEST_LIMIT) {
    return refuseTaskExecution('CAPACITY_EXCEEDED')
  }
  return { ...task, modelDispatchAttempts: attempts + 1 }
}
