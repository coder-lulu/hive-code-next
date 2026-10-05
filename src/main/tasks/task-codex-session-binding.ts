import { isDeepStrictEqual as same } from 'node:util'
import { agentSessionLeaseAdmitsWriter } from '../../shared/agent-session-lease-adjudication'
import { isAgentSessionRecord } from '../../shared/agent-session-record'
import {
  taskSessionSourceReference,
  type TaskStructuredBinding
} from '../../shared/task-execution/task-structured-binding'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

/** Currentness of original validated records; the Host grant remains a separate requirement. */
export function assertTaskCodexSessionBinding(
  state: AgentSessionStoreState,
  task: TaskExecutionRecord,
  binding: TaskStructuredBinding,
  allowReserved = false
): void {
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
  if (lease.unreconciled || lease.deathEvidence !== null) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  if (allowReserved && lease.claimStatus === 'reserved') {
    if (
      lease.handoffStage !== 'new-owner-proving' ||
      lease.provenHandleLinkId !== null ||
      session.providerHandleChain.length !== 0
    ) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
  } else if (!agentSessionLeaseAdmitsWriter(lease) || !owner) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  if (
    lease.runtimeKind !== 'native' ||
    lease.sessionId !== binding.sessionId ||
    lease.runtimeFence !== binding.runtimeFence ||
    lease.reservedSpawnToken !== binding.spawnToken ||
    (owner && (owner.spawnToken !== binding.spawnToken || owner.hostId !== state.hostId))
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
}
