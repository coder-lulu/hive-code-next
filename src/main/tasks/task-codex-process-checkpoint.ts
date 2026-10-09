import { isDeepStrictEqual as same } from 'node:util'
import { isTaskSessionRecord } from './task-codex-session-binding'
import type { TaskStructuredBinding } from '../../shared/task-execution/task-structured-binding'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { refuseTaskExecution } from './task-execution-error'

/** Uses the original committed owner identity, never a container ID or a reservation alone. */
export function assertTaskCodexProcessCheckpoint(
  store: AgentSessionRecordStore,
  binding: TaskStructuredBinding,
  pid: number | undefined
): void {
  store.tasks.assertStructuredBindingCurrent(binding)
  const record = store.getRecord(binding.sessionId)
  const owner = record?.lease.ownerProcess
  if (
    !record ||
    !isTaskSessionRecord(record) ||
    !owner ||
    !Number.isSafeInteger(pid) ||
    owner.pid !== pid ||
    owner.hostId !== binding.location.executionHostId ||
    owner.spawnToken !== binding.spawnToken ||
    record.lease.runtimeFence !== binding.runtimeFence ||
    record.lease.reservedSpawnToken !== binding.spawnToken ||
    !same(record.taskSource, binding.source) ||
    !same(record.location, binding.location) ||
    !same(record.accountHome, binding.accountHome)
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
}
