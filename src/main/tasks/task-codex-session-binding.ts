import { isDeepStrictEqual as same } from 'node:util'
import { agentSessionLeaseAdmitsWriter } from '../../shared/agent-session-lease-adjudication'
import { isAgentSessionRecord } from '../../shared/agent-session-record'
import { taskDockerSessionProbeForRecord } from './task-docker-session-owner'
import {
  taskSessionSourceReference,
  type TaskStructuredBinding
} from '../../shared/task-execution/task-structured-binding'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import {
  TaskExecutionRecordSchema,
  taskExecutionRecordKey,
  type TaskExecutionRecord
} from './task-execution-record'
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

/** Stop admission uses the original reservation; cancellation never admits another writer. */
export function assertTaskCodexFailedBootBinding(
  state: AgentSessionStoreState,
  expected: TaskExecutionRecord,
  requireStopped = false
) {
  const task = state.taskExecutions?.get(taskExecutionRecordKey(expected.command))
  if (
    state.taskRecoveryBlocked ||
    !TaskExecutionRecordSchema.safeParse(expected).success ||
    !task ||
    !same(task, expected) ||
    task.dispatch !== 'dispatching' ||
    !task.cancellationKey ||
    task.result !== null ||
    !task.structuredBinding ||
    !task.dockerIdentity?.containerId
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const binding = task.structuredBinding
  const session = state.records.get(binding.sessionId)
  if (
    state.hostId !== 'local' ||
    state.unreadableRecords.has(binding.sessionId) ||
    !session ||
    !isAgentSessionRecord(session) ||
    session.sessionId !== binding.sessionId ||
    session.provider !== 'codex' ||
    !same(taskSessionSourceReference(task), binding.source) ||
    !same(session.taskSource, binding.source) ||
    !same(session.accountHome, binding.accountHome) ||
    !same(session.location, binding.location) ||
    session.lease.runtimeKind !== 'native' ||
    session.lease.sessionId !== binding.sessionId ||
    session.lease.unreconciled
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const lease = session.lease
  const death = lease.deathEvidence
  if (
    lease.claimStatus === 'released' &&
    lease.ownerProcess === null &&
    lease.reservedSpawnToken === null &&
    lease.runtimeFence > binding.runtimeFence &&
    death?.kind === 'execution-host-exit-observed' &&
    death.ownerFence === binding.runtimeFence &&
    taskDockerSessionProbeForRecord(
      session,
      { outcome: 'execution-host-exited', witness: death.witness },
      state.taskExecutions
    ).outcome === 'execution-host-exited'
  ) {
    return session
  }
  if (
    requireStopped ||
    death !== null ||
    !['reserved', 'live'].includes(lease.claimStatus) ||
    lease.runtimeFence !== binding.runtimeFence ||
    lease.reservedSpawnToken !== binding.spawnToken ||
    (lease.ownerProcess &&
      (lease.ownerProcess.hostId !== 'local' ||
        lease.ownerProcess.spawnToken !== binding.spawnToken))
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  return session
}
