import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import { assertTaskExecutionSnapshotCurrent } from './task-execution-snapshot-guard'
import { agentSessionOperationKey } from '../../shared/agent-session-operation-ledger'
import { isAgentLaunchResult } from '../../shared/agent-launch-intent'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import type { AgentLaunchResult } from '../../shared/agent-launch-intent'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

export function bindTaskLaunch(
  record: TaskExecutionRecord,
  launch: AgentLaunchResult
): TaskExecutionRecord | null {
  if (record.dispatch === 'bound') {
    if (!record.launch) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    if (canonicalAgentSessionDigest(record.launch) !== canonicalAgentSessionDigest(launch)) {
      return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
    }
    return null
  }
  if (
    record.dispatch !== 'dispatching' ||
    record.result ||
    launch.worktreeId !== record.workspace.workspaceId
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  return {
    ...record,
    dispatch: 'bound',
    launch,
    status: record.cancellationKey ? 'cancel_requested' : 'running'
  }
}

export function recoverTaskLaunch(
  state: AgentSessionStoreState,
  record: TaskExecutionRecord,
  expected: TaskExecutionRecord,
  fingerprint: string,
  validate: () => void
): TaskExecutionRecord | null {
  assertTaskExecutionSnapshotCurrent(expected, record)
  validate()
  if (record.dispatch !== 'dispatching' || record.result) {
    return null
  }
  const row = state.operations.get(
    agentSessionOperationKey(record.operationCallerKey, record.command.operationId)
  )
  if (
    row &&
    (row.callerKey !== record.operationCallerKey ||
      row.operationId !== record.command.operationId ||
      row.fingerprint !== fingerprint)
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  if (row?.outcome.status !== 'succeeded' || !isAgentLaunchResult(row.outcome.launch)) {
    return null
  }
  return bindTaskLaunch(record, row.outcome.launch)
}
