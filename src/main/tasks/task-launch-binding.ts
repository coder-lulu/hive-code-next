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
