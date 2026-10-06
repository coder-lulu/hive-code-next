import {
  computeAgentLaunchFingerprint,
  deriveAgentLaunchChildOperationId
} from '../../shared/agent-launch-operation'
import {
  agentSessionOperationKey,
  isAgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import { TaskExecutionRecordSchema, type TaskExecutionRecord } from './task-execution-record'
import { taskCancelledResult } from './task-cancelled-result'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { assertTaskExecutionSnapshotCurrent } from './task-execution-snapshot-guard'
import { createTaskDockerBoundary } from './task-docker-boundary'
import { refuseTaskExecution } from './task-execution-error'
import { taskAgentLaunchParams } from './task-agent-launch-params'
import { TASK_ENFORCEMENT_CAPABILITY } from '../../shared/task-execution/task-execution-primitives'
import { isTaskDockerEnforcementPolicy } from './task-docker-enforcement'

export function createTaskCancelledDispatchSettlement(store: AgentSessionRecordStore) {
  return async (record: TaskExecutionRecord, input: string, validate: () => void) => {
    await store.tasks.settleCancelledCodexDispatch(
      record,
      computeAgentLaunchFingerprint(taskAgentLaunchParams(record, input, 'codex')),
      Date.now,
      validate
    )
    const expected = store.tasks.get(record.command)
    if (
      !expected ||
      expected.result ||
      !expected.cancellationKey ||
      expected.dispatch !== 'dispatching' ||
      expected.launch ||
      Object.hasOwn(expected, 'modelDispatchAttempts') ||
      !expected.structuredBinding ||
      !expected.dockerIdentity
    ) {
      return
    }
    assertTaskExecutionSnapshotCurrent(record, expected)
    const session = store.getRecord(expected.structuredBinding.sessionId)
    if (
      !session ||
      session.lease.claimStatus !== 'reserved' ||
      session.lease.ownerProcess ||
      session.providerHandleChain.length
    ) {
      return
    }
    const expectedSession = structuredClone(session)
    validate()
    const boundary = createTaskDockerBoundary({
      ...expected.dockerIdentity,
      record: expected,
      recoveryIdentity: expected.dockerIdentity,
      assertCurrent: () => refuseTaskExecution('FORBIDDEN')
    })
    const evidence = await boundary.proveNeverStarted()
    validate()
    if (evidence) {
      await store.tasks.settleCancelledDockerPrestart(
        record,
        expected,
        expectedSession,
        evidence,
        Date.now,
        validate
      )
    }
  }
}

/** Only the private enforced Codex host calls this, after its exact launch flight drained. */
export function settleCancelledTaskCodexDispatch(
  state: AgentSessionStoreState,
  record: TaskExecutionRecord,
  fingerprint: string,
  now: number,
  expected: TaskExecutionRecord
): TaskExecutionRecord | null {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    state.schemaVersion !== 4 ||
    state.hostId !== 'local' ||
    state.taskRecoveryBlocked ||
    state.unreadableRecords.size !== 0 ||
    record.workspace.hostId !== state.hostId ||
    !TaskExecutionRecordSchema.safeParse(record).success ||
    !record.cancellationKey ||
    record.result ||
    !['cancel_requested', 'outcome_unknown'].includes(record.status) ||
    record.dispatch !== 'dispatching' ||
    expected.launch !== null ||
    Object.hasOwn(expected, 'structuredBinding') ||
    Object.hasOwn(expected, 'dockerIdentity') ||
    Object.hasOwn(expected, 'modelDispatchAttempts') ||
    record.launch ||
    !isTaskDockerEnforcementPolicy(record.command.executionPolicy) ||
    !record.command.requiredCapabilities.includes(TASK_ENFORCEMENT_CAPABILITY) ||
    Object.hasOwn(record, 'structuredBinding') ||
    Object.hasOwn(record, 'dockerIdentity') ||
    Object.hasOwn(record, 'modelDispatchAttempts')
  ) {
    return null
  }
  const parent = state.operations.get(
    agentSessionOperationKey(record.operationCallerKey, record.command.operationId)
  )
  const childId = deriveAgentLaunchChildOperationId(record.command.operationId)
  if (
    !parent ||
    !childId ||
    !isAgentSessionOperationRow(parent) ||
    parent.expiresAt <= now ||
    parent.callerKey !== record.operationCallerKey ||
    parent.operationId !== record.command.operationId ||
    parent.fingerprint !== fingerprint ||
    !['unknown', 'failed'].includes(parent.outcome.status)
  ) {
    return null
  }
  for (const row of state.operations.values()) {
    if (row.operationId === childId || (row.operationId === parent.operationId && row !== parent)) {
      return null
    }
  }
  for (const session of state.records.values()) {
    if (
      session.location.workspaceId === record.workspace.workspaceId ||
      (session.taskSource?.runtimeRecordId === record.command.runtimeRecordId &&
        session.taskSource.executionId === record.command.executionId)
    ) {
      return null
    }
  }
  return { ...record, status: 'cancelled', result: taskCancelledResult(record, 'not_started', now) }
}
