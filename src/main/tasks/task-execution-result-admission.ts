import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import {
  TaskExecutionResultSchema,
  type TaskExecutionResult
} from '../../shared/task-execution/task-execution-receipts'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskExecutionSnapshotCurrent } from './task-execution-snapshot-guard'
import { assertTaskCodexFailedBootBinding } from './task-codex-session-binding'
export function admitTaskExecutionResult(
  state: AgentSessionStoreState,
  record: TaskExecutionRecord,
  resultValue: TaskExecutionResult | ((record: TaskExecutionRecord) => TaskExecutionResult),
  stopping: TaskExecutionRecord | undefined,
  readFatal: () => boolean
): TaskExecutionRecord | null {
  // A competing collector may have settled while this transaction waited for the lock.
  if (record.result && typeof resultValue === 'function') {
    return null
  }
  const result = TaskExecutionResultSchema.parse(
    typeof resultValue === 'function' ? resultValue(structuredClone(record)) : resultValue
  )
  if (record.result) {
    if (canonicalAgentSessionDigest(result) !== canonicalAgentSessionDigest(record.result)) {
      return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
    }
    return null
  }
  const fatal = readFatal()
  if (
    (result.status === 'cancelled' || (result.status === 'failed' && fatal)) &&
    result.stopProof.evidenceKind === 'stopped' &&
    (fatal ||
      (record.dispatch === 'dispatching' && record.structuredBinding) ||
      (stopping?.dispatch === 'dispatching' && stopping.structuredBinding))
  ) {
    if (!stopping) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    assertTaskExecutionSnapshotCurrent(stopping, record)
    assertTaskCodexFailedBootBinding(state, fatal ? record : stopping, true, fatal)
  }
  if (
    (result.stopProof.evidenceKind === 'not_started' && record.dispatch !== 'not_dispatched') ||
    (result.status === 'succeeded' &&
      (record.dispatch !== 'bound' || record.cancellationKey !== null)) ||
    (result.status === 'cancelled' && record.cancellationKey === null)
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  return { ...record, result, status: result.status }
}
