import { isDeepStrictEqual as same } from 'node:util'
import type Database from '../sqlite/sync-database'
import type { JournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database'
import { agentSessionRefusalError } from '../../shared/agent-session-wire-refusals'
import { taskExecutionEvidenceRegressed } from '../tasks/task-execution-evidence-regression'
import { refuseTaskExecution } from '../tasks/task-execution-error'
import type { TaskExecutionRecord } from '../tasks/task-execution-record'
import type { AgentSessionStoreState } from './agent-session-store-contract'
import { loadAgentSessionStoreRows, writeAgentSessionStoreRows } from './agent-session-record-rows'
import {
  agentSessionStoreDraftRowWrites,
  draftAgentSessionStoreState
} from './agent-session-store-draft'

type Version = { changes: number; external: number }

function version(db: Database.Database): Version {
  return {
    changes: Number(db.prepare('SELECT total_changes() AS count').get()?.count),
    external: Number(db.pragma('data_version', { simple: true }))
  }
}

function reuseRows<K, V>(previous: Map<K, V> | undefined, loaded: Map<K, V> | undefined) {
  if (!loaded || !previous) {
    return loaded
  }
  for (const [key, value] of loaded) {
    const prior = previous.get(key)
    if (same(prior, value)) {
      loaded.set(key, prior!)
    }
  }
  return same(previous, loaded) ? previous : loaded
}

function reuseState(previous: AgentSessionStoreState, loaded: AgentSessionStoreState) {
  loaded.records = reuseRows(previous.records, loaded.records)!
  loaded.operations = reuseRows(previous.operations, loaded.operations)!
  loaded.unreadableRecords = reuseRows(previous.unreadableRecords, loaded.unreadableRecords)!
  loaded.hiveSessions = reuseRows(previous.hiveSessions, loaded.hiveSessions)
  loaded.taskExecutions = reuseRows(previous.taskExecutions, loaded.taskExecutions)
  if (same(previous.retiredClaimKeys, loaded.retiredClaimKeys)) {
    loaded.retiredClaimKeys = previous.retiredClaimKeys
  }
  if (
    previous.sessionTabs &&
    loaded.sessionTabs &&
    previous.sessionTabs.equals(loaded.sessionTabs)
  ) {
    loaded.sessionTabs = previous.sessionTabs
  }
  if (same(previous.unrecordedSessionTabs, loaded.unrecordedSessionTabs)) {
    loaded.unrecordedSessionTabs = previous.unrecordedSessionTabs
  }
  return same(previous, loaded) ? previous : loaded
}

/** Committed SQL invalidation and lost-effect fencing for the one host store. */
export class AgentSessionStoreCommittedRefresh {
  private seen: Version | undefined
  private refreshing = false
  private fencePending = false
  private failedTaskWrites: Map<string, TaskExecutionRecord | undefined> | undefined
  private unacknowledgedCommit = false

  constructor(
    private readonly database: JournalHostDatabase,
    private readonly read: () => AgentSessionStoreState,
    private readonly publish: (state: AgentSessionStoreState) => void,
    private readonly refuseReadOnly: () => Error
  ) {}

  recordFailedTaskWrite(previous: AgentSessionStoreState, draft: AgentSessionStoreState): void {
    const changed = new Map<string, TaskExecutionRecord | undefined>()
    for (const key of new Set([
      ...(previous.taskExecutions?.keys() ?? []),
      ...(draft.taskExecutions?.keys() ?? [])
    ])) {
      const before = previous.taskExecutions?.get(key)
      const after = draft.taskExecutions?.get(key)
      if (!same(before, after)) {
        changed.set(key, structuredClone(after))
      }
    }
    this.failedTaskWrites = changed.size ? changed : undefined
  }

  refresh(): void {
    const db = this.database.db
    if (this.refreshing) {
      return
    }
    if (db.isTransaction) {
      if (this.failedTaskWrites || this.fencePending) {
        throw this.stale()
      }
      return
    }
    const observed = version(db)
    if (!this.failedTaskWrites && !this.fencePending && same(this.seen, observed)) {
      return
    }
    this.refreshing = true
    try {
      const previous = this.read()
      const loaded = reuseState(previous, loadAgentSessionStoreRows(db, previous.hostId, previous))
      if (!same(version(db), observed)) {
        throw this.stale()
      }
      this.unacknowledgedCommit ||= [...(this.failedTaskWrites ?? [])].some(([key, expected]) =>
        same(loaded.taskExecutions?.get(key), expected)
      )
      const lost = taskExecutionEvidenceRegressed(previous.taskExecutions, loaded.taskExecutions)
      const retained = previous.taskRecoveryBlocked === true && !loaded.taskRecoveryBlocked
      this.fencePending ||= lost || retained || this.unacknowledgedCommit
      if (this.fencePending) {
        if (this.database.readOnly) {
          throw this.refuseReadOnly()
        }
        const fenced = { ...draftAgentSessionStoreState(loaded), taskRecoveryBlocked: true }
        const writes = agentSessionStoreDraftRowWrites(loaded, fenced)
        if (writes) {
          this.database.transaction((transaction) => {
            if (version(transaction).external !== observed.external) {
              throw this.stale()
            }
            writeAgentSessionStoreRows(transaction, writes)
          })
        }
        this.publish(fenced)
        this.fencePending = false
      } else if (loaded !== previous) {
        this.publish(loaded)
      }
      // Own writes change total_changes; an external commit must still be noticed on the next guard.
      this.seen = { changes: version(db).changes, external: observed.external }
      this.failedTaskWrites = undefined
      if (this.unacknowledgedCommit) {
        this.unacknowledgedCommit = false
        refuseTaskExecution('OUTCOME_UNKNOWN')
      }
    } finally {
      this.refreshing = false
    }
  }

  assertTransactionCurrent(db: Database.Database): void {
    if (
      this.failedTaskWrites ||
      this.fencePending ||
      !this.seen ||
      version(db).external !== this.seen.external
    ) {
      throw this.stale()
    }
  }

  committed(): void {
    if (!this.seen) {
      return
    }
    try {
      this.seen = { ...this.seen, changes: version(this.database.db).changes }
    } catch {
      // A cache probe cannot turn a committed write into a failure; the next guard revalidates.
      this.seen = undefined
    }
  }

  private stale(): Error {
    return agentSessionRefusalError('agent_session_ownership_unknown', {
      reason: 'replaySuperseded'
    })
  }
}
