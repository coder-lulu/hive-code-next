import { isDeepStrictEqual as same } from 'node:util'
import type Database from '../sqlite/sync-database'
import type { JournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database'
import { agentSessionRefusalError } from '../../shared/agent-session-wire-refusals'
import type { AgentSessionStoreState } from './agent-session-store-contract'
import { loadAgentSessionStoreRows } from './agent-session-record-rows'

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
  loaded.runtimeEnds = previous.runtimeEnds
  loaded.records = reuseRows(previous.records, loaded.records)!
  loaded.operations = reuseRows(previous.operations, loaded.operations)!
  loaded.unreadableRecords = reuseRows(previous.unreadableRecords, loaded.unreadableRecords)!
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

/** Committed SQL invalidation for the one host store. */
export class AgentSessionStoreCommittedRefresh {
  private seen: Version | undefined
  private refreshing = false

  constructor(
    private readonly database: JournalHostDatabase,
    private readonly read: () => AgentSessionStoreState,
    private readonly publish: (state: AgentSessionStoreState) => void
  ) {}

  refresh(): void {
    const db = this.database.db
    if (this.refreshing) {
      return
    }
    if (db.isTransaction) {
      return
    }
    const observed = version(db)
    if (same(this.seen, observed)) {
      return
    }
    this.refreshing = true
    try {
      const previous = this.read()
      const loaded = reuseState(previous, loadAgentSessionStoreRows(db, previous.hostId, previous))
      if (!same(version(db), observed)) {
        throw this.stale()
      }
      if (loaded !== previous) {
        this.publish(loaded)
      }
      // Own writes change total_changes; an external commit must still be noticed on the next guard.
      this.seen = { changes: version(db).changes, external: observed.external }
    } finally {
      this.refreshing = false
    }
  }

  assertTransactionCurrent(db: Database.Database): void {
    if (!this.seen || version(db).external !== this.seen.external) {
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
