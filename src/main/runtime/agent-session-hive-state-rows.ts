/** Hive business state shares the host journal transaction with its operation ledger. */
import { isRecord } from '../../shared/agent-status-child-work-value-guards'
import { hiveAgentSessionEntrySchema } from '../../shared/hive-agent-session-entry'
import { TaskExecutionRecordSchema, taskExecutionRecordKey } from '../tasks/task-execution-record'
import type Database from '../sqlite/sync-database'
import type { AgentSessionStoreState } from './agent-session-store-contract'

const HIVE_STATE_KEY = 'hive_runtime_state'

export function serializeHiveRuntimeState(state: AgentSessionStoreState): string {
  const json = JSON.stringify({
    hostId: state.hostId,
    hiveSessions: Object.fromEntries(state.hiveSessions ?? []),
    taskExecutions: Object.fromEntries(state.taskExecutions ?? []),
    hiveRecoveryFenceAt: state.hiveRecoveryFenceAt,
    taskRecoveryBlocked: state.taskRecoveryBlocked
  })
  // Validate precisely the bytes a later load will read, before entering the transaction.
  parseHiveRuntimeState(json, state.hostId)
  return json
}

function parseHiveRuntimeState(json: string, hostId: string) {
  const value: unknown = JSON.parse(json)
  if (
    !isRecord(value) ||
    value.hostId !== hostId ||
    !isRecord(value.hiveSessions) ||
    !isRecord(value.taskExecutions) ||
    (value.hiveRecoveryFenceAt !== undefined &&
      (typeof value.hiveRecoveryFenceAt !== 'number' ||
        !Number.isSafeInteger(value.hiveRecoveryFenceAt) ||
        value.hiveRecoveryFenceAt < 0)) ||
    (value.taskRecoveryBlocked !== undefined && typeof value.taskRecoveryBlocked !== 'boolean')
  ) {
    throw new Error('agent_session_store_write_invalid')
  }
  const hiveSessions = new Map<string, ReturnType<typeof hiveAgentSessionEntrySchema.parse>>()
  for (const [key, raw] of Object.entries(value.hiveSessions)) {
    const entry = hiveAgentSessionEntrySchema.parse(raw)
    if (entry.aggregate.session.sessionId !== key) {
      throw new Error('agent_session_store_write_invalid')
    }
    hiveSessions.set(key, entry)
  }
  const taskExecutions = new Map<string, ReturnType<typeof TaskExecutionRecordSchema.parse>>()
  for (const [key, raw] of Object.entries(value.taskExecutions)) {
    const record = TaskExecutionRecordSchema.parse(raw)
    if (taskExecutionRecordKey(record.command) !== key) {
      throw new Error('agent_session_store_write_invalid')
    }
    taskExecutions.set(key, record)
  }
  return {
    hiveSessions,
    taskExecutions,
    hiveRecoveryFenceAt: value.hiveRecoveryFenceAt,
    taskRecoveryBlocked: value.taskRecoveryBlocked
  }
}

export function loadHiveRuntimeState(db: Database.Database, state: AgentSessionStoreState): void {
  const row = db
    .prepare('SELECT value FROM agent_session_store_meta WHERE key = ?')
    .get(HIVE_STATE_KEY)
  if (!row) {
    state.hiveSessions = new Map()
    state.taskExecutions = new Map()
    return
  }
  if (typeof row.value !== 'string') {
    throw new Error('agent_session_store_write_invalid')
  }
  Object.assign(state, parseHiveRuntimeState(row.value, state.hostId))
}

export function writeHiveRuntimeState(
  db: Database.Database,
  json: string,
  onlyIfAbsent = false
): void {
  db.prepare(
    onlyIfAbsent
      ? 'INSERT OR IGNORE INTO agent_session_store_meta (key, value) VALUES (?, ?)'
      : 'INSERT OR REPLACE INTO agent_session_store_meta (key, value) VALUES (?, ?)'
  ).run(HIVE_STATE_KEY, json)
}

function sameEntries<T>(
  a: ReadonlyMap<string, T> | undefined,
  b: ReadonlyMap<string, T> | undefined
): boolean {
  if ((a?.size ?? 0) !== (b?.size ?? 0)) {
    return false
  }
  return !a || [...a].every(([key, value]) => b?.get(key) === value)
}

export function hiveRuntimeStateChanged(
  a: AgentSessionStoreState,
  b: AgentSessionStoreState
): boolean {
  return (
    !sameEntries(a.hiveSessions, b.hiveSessions) ||
    !sameEntries(a.taskExecutions, b.taskExecutions) ||
    a.hiveRecoveryFenceAt !== b.hiveRecoveryFenceAt ||
    a.taskRecoveryBlocked !== b.taskRecoveryBlocked
  )
}
