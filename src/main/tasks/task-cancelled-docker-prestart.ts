import { isDeepStrictEqual as same } from 'node:util'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  agentSessionOperationKey,
  isAgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'
import { deriveAgentLaunchChildOperationId } from '../../shared/agent-launch-operation'
import { taskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import { TASK_ENFORCEMENT_CAPABILITY } from '../../shared/task-execution/task-execution-primitives'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import type { TaskDockerNeverStartedEvidence } from './task-docker-boundary'
import { isTaskDockerEnforcementPolicy } from './task-docker-enforcement'
import { TaskExecutionRecordSchema, type TaskExecutionRecord } from './task-execution-record'
import { taskCancelledResult } from './task-cancelled-result'

/** The original private host supplies a twice-validated container proof after its launch drains. */
export function settleCancelledTaskDockerPrestart(
  state: AgentSessionStoreState,
  record: TaskExecutionRecord,
  authorized: TaskExecutionRecord,
  expected: TaskExecutionRecord,
  expectedSession: AgentSessionRecord,
  evidence: TaskDockerNeverStartedEvidence,
  now: number
): TaskExecutionRecord | null {
  const binding = record.structuredBinding
  const identity = record.dockerIdentity
  const session = binding && state.records.get(binding.sessionId)
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(evidence.observedAt) ||
    evidence.observedAt < 0 ||
    now < evidence.observedAt ||
    now - evidence.observedAt > 10_000 ||
    !/^[0-9a-f]{64}$/.test(evidence.containerId) ||
    state.schemaVersion !== 4 ||
    state.hostId !== 'local' ||
    state.taskRecoveryBlocked ||
    state.unreadableRecords.size !== 0 ||
    !TaskExecutionRecordSchema.safeParse(record).success ||
    record.workspace.hostId !== 'local' ||
    !record.cancellationKey ||
    record.result ||
    !['cancel_requested', 'outcome_unknown'].includes(record.status) ||
    record.dispatch !== 'dispatching' ||
    record.launch ||
    authorized.launch ||
    expected.launch ||
    [record, authorized, expected].some((task) => Object.hasOwn(task, 'modelDispatchAttempts')) ||
    !isTaskDockerEnforcementPolicy(record.command.executionPolicy) ||
    !record.command.requiredCapabilities.includes(TASK_ENFORCEMENT_CAPABILITY) ||
    !binding ||
    !identity ||
    (identity.containerId !== null && identity.containerId !== evidence.containerId) ||
    !same(binding, expected.structuredBinding) ||
    !same(identity, expected.dockerIdentity) ||
    (authorized.structuredBinding && !same(authorized.structuredBinding, binding)) ||
    (authorized.dockerIdentity && !same(authorized.dockerIdentity, identity)) ||
    !session ||
    !same(session, expectedSession) ||
    session.provider !== 'codex' ||
    !same(session.taskSource, taskSessionSourceReference(record)) ||
    !same(session.taskSource, binding.source) ||
    !same(session.location, binding.location) ||
    !same(session.accountHome, binding.accountHome) ||
    session.lease.runtimeFence !== binding.runtimeFence ||
    session.lease.reservedSpawnToken !== binding.spawnToken ||
    session.lease.claimStatus !== 'reserved' ||
    session.lease.ownerProcess !== null ||
    session.providerHandleChain.length !== 0
  ) {
    return null
  }
  const parent = state.operations.get(
    agentSessionOperationKey(record.operationCallerKey, record.command.operationId)
  )
  const childId = deriveAgentLaunchChildOperationId(record.command.operationId)
  const child =
    childId && state.operations.get(agentSessionOperationKey(record.operationCallerKey, childId))
  if (
    !parent ||
    !child ||
    !isAgentSessionOperationRow(parent) ||
    !isAgentSessionOperationRow(child) ||
    parent.expiresAt <= now ||
    child.expiresAt <= now ||
    !['unknown', 'failed'].includes(parent.outcome.status) ||
    child.outcome.status !== 'failed' ||
    parent.fingerprint !== binding.launchFingerprint ||
    binding.operationId !== parent.operationId ||
    binding.operationCallerKey !== parent.callerKey ||
    child.operationId !== binding.attachOperationId ||
    child.fingerprint !== binding.attachFingerprint
  ) {
    return null
  }
  for (const row of state.operations.values()) {
    if (
      (row.operationId === parent.operationId && row !== parent) ||
      (row.operationId === child.operationId && row !== child)
    ) {
      return null
    }
  }
  for (const other of state.records.values()) {
    if (
      other !== session &&
      (other.location.workspaceId === record.workspace.workspaceId ||
        (other.taskSource?.runtimeRecordId === record.command.runtimeRecordId &&
          other.taskSource.executionId === record.command.executionId))
    ) {
      return null
    }
  }
  return { ...record, status: 'cancelled', result: taskCancelledResult(record, 'not_started', now) }
}
