import { isDeepStrictEqual as same } from 'node:util'
import { isAgentSessionRecord } from '../../shared/agent-session-record'
import { taskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import { refuseTaskExecution } from './task-execution-error'
import { TaskExecutionRecordSchema, type TaskExecutionRecord } from './task-execution-record'
import { assertTaskExecutionSnapshotCurrent } from './task-execution-snapshot-guard'
import { taskDockerSessionProbeForRecord } from './task-docker-session-owner'

/** Diagnostic admission retains original provenance without granting writer or stop authority. */
export function assertTaskFailureSnapshotCurrent(
  state: AgentSessionStoreState,
  expected: TaskExecutionRecord,
  current: TaskExecutionRecord
) {
  if (state.taskRecoveryBlocked || !TaskExecutionRecordSchema.safeParse(expected).success) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  assertTaskExecutionSnapshotCurrent(expected, current)
  if (state.hostId !== 'local' || !same(expected.structuredBinding, current.structuredBinding)) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  const binding = expected.structuredBinding
  if (!binding) {
    return
  }
  const session = state.records.get(binding.sessionId)
  if (
    state.unreadableRecords.has(binding.sessionId) ||
    !session ||
    !isAgentSessionRecord(session)
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  if (
    session.sessionId !== binding.sessionId ||
    session.provider !== 'codex' ||
    !same(taskSessionSourceReference(current), binding.source) ||
    !same(session.taskSource, binding.source) ||
    !same(session.accountHome, binding.accountHome) ||
    !same(session.location, binding.location)
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  const lease = session.lease
  if (lease.runtimeKind !== 'native' || lease.sessionId !== binding.sessionId) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  if (lease.deathEvidence?.kind === 'execution-host-exit-observed') {
    if (
      taskDockerSessionProbeForRecord(
        session,
        {
          outcome: 'execution-host-exited',
          witness: lease.deathEvidence.witness
        },
        state.taskExecutions
      ).outcome !== 'execution-host-exited'
    ) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
  } else if (
    lease.deathEvidence !== null ||
    lease.runtimeFence !== binding.runtimeFence ||
    lease.reservedSpawnToken !== binding.spawnToken ||
    (lease.ownerProcess &&
      (lease.ownerProcess.hostId !== 'local' ||
        lease.ownerProcess.spawnToken !== binding.spawnToken))
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
}
