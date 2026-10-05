import {
  readLegacyAgentSessionRecords,
  legacyAgentSessionRecordImport
} from './agent-session-legacy-record-import'
import { emptyState } from './agent-session-store-parsing'
import {
  loadHiveRuntimeState,
  serializeHiveRuntimeState,
  writeHiveRuntimeState
} from './agent-session-hive-state-rows'
/**
 * The one way tests open, seed and read back the durable agent-session record store, so a change
 * to where or how the store persists is made here rather than in every test that uses it. Every
 * function takes the host's state directory: the store is rows in its chat journal database, opened
 * through the test database registry, so `closeTestJournalHostDatabases` closes it too.
 */

import type { AgentSessionOperationRow } from '../../shared/agent-session-operation-ledger'
import type { PersistedAgentSessionRecord } from '../../shared/agent-session-legacy-handoff-lease'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import type { TaskExecutionRecord } from '../tasks/task-execution-record'
import { JOURNAL_DB_SCHEMA_VERSION } from '../native-chat/agent-session-journal/journal-database-schema'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import type Database from '../sqlite/sync-database'
import { AgentSessionRecordStore } from './agent-session-record-store'
import {
  AGENT_SESSION_STORE_SCHEMA_VERSION,
  type RetiredAgentSessionClaimKey
} from './agent-session-record-store-file'

const TEST_HOST_ID = 'local'

/** One committed state of the store, as tests seed it and read it back. */
export type PersistedTestAgentSessionStore = {
  schemaVersion: number
  hostId: string
  /** Every record row as stored, including one this build cannot read. */
  records: Record<string, PersistedAgentSessionRecord>
  operations: Record<string, AgentSessionOperationRow>
  retiredClaimKeys: RetiredAgentSessionClaimKey[]
  /** Written as raw record rows; always empty on a read, where `records` holds every row. */
  unusableRecords: Record<string, { reason: string; raw: unknown }>
  hiveSessions: Record<string, HiveAgentSessionEntry>
  taskExecutions: Record<string, TaskExecutionRecord>
  hiveRecoveryFenceAt?: number
  taskRecoveryBlocked?: boolean
  /** Absent until the store first records a chat tab. */
  sessionTabs?: { tabId: string; sessionId: string }[]
}

function databaseFor(stateDirectory: string): Database.Database {
  return openTestJournalHostDatabase(stateDirectory).db
}

/** Opens, or reopens, the store in `stateDirectory`: what a fresh app process does at launch. */
export async function openTestAgentSessionRecordStore(
  stateDirectory: string,
  options: { hostId?: string } = {}
): Promise<AgentSessionRecordStore> {
  return AgentSessionRecordStore.open({
    journalDatabase: openTestJournalHostDatabase(stateDirectory),
    hostId: options.hostId ?? TEST_HOST_ID
  })
}

/** Exercises the production read-only legacy import into a fresh host journal. */
export async function importTestLegacyAgentSessionRecordStore(
  stateDirectory: string,
  options: { hostId?: string } = {}
): Promise<AgentSessionRecordStore> {
  const hostId = options.hostId ?? TEST_HOST_ID
  const legacy = await readLegacyAgentSessionRecords(stateDirectory, hostId)
  const journalDatabase = openTestJournalHostDatabase(
    stateDirectory,
    legacyAgentSessionRecordImport(legacy, hostId, () => undefined)
  )
  return AgentSessionRecordStore.open({ journalDatabase, hostId })
}

function writePersisted(db: Database.Database, persisted: PersistedTestAgentSessionStore): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const table of [
      'agent_session_records',
      'agent_session_operations',
      'agent_session_retired_claim_keys',
      'agent_session_tabs',
      'agent_session_store_meta'
    ]) {
      db.prepare(`DELETE FROM ${table}`).run()
    }
    const insertRecord = db.prepare(
      'INSERT OR REPLACE INTO agent_session_records (session_id, record_json) VALUES (?, ?)'
    )
    for (const [sessionId, { raw }] of Object.entries(persisted.unusableRecords)) {
      insertRecord.run(sessionId, JSON.stringify(raw ?? null))
    }
    for (const [sessionId, record] of Object.entries(persisted.records)) {
      insertRecord.run(sessionId, JSON.stringify(record))
    }
    for (const [key, row] of Object.entries(persisted.operations)) {
      db.prepare(
        'INSERT INTO agent_session_operations (operation_key, row_json) VALUES (?, ?)'
      ).run(key, JSON.stringify(row))
    }
    for (const { keyId, retiredAt } of persisted.retiredClaimKeys) {
      db.prepare(
        'INSERT INTO agent_session_retired_claim_keys (key_id, retired_at) VALUES (?, ?)'
      ).run(keyId, retiredAt)
    }
    if (persisted.sessionTabs) {
      persisted.sessionTabs.forEach(({ tabId, sessionId }, position) =>
        db
          .prepare('INSERT INTO agent_session_tabs (tab_id, session_id, position) VALUES (?, ?, ?)')
          .run(tabId, sessionId, position)
      )
      db.prepare(
        "INSERT INTO agent_session_store_meta (key, value) VALUES ('session_tabs_recorded', '1')"
      ).run()
    }
    writeHiveRuntimeState(
      db,
      serializeHiveRuntimeState({
        ...emptyState(persisted.hostId),
        hiveSessions: new Map(Object.entries(persisted.hiveSessions)),
        taskExecutions: new Map(Object.entries(persisted.taskExecutions)),
        hiveRecoveryFenceAt: persisted.hiveRecoveryFenceAt,
        taskRecoveryBlocked: persisted.taskRecoveryBlocked
      })
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Leaves `records` behind as an earlier run of the app would have, before anything opens it. */
export async function seedTestAgentSessionRecordStore(
  stateDirectory: string,
  seed: { records: readonly PersistedAgentSessionRecord[] }
): Promise<void> {
  writePersisted(databaseFor(stateDirectory), {
    schemaVersion: AGENT_SESSION_STORE_SCHEMA_VERSION,
    hostId: TEST_HOST_ID,
    records: Object.fromEntries(seed.records.map((record) => [record.sessionId, record])),
    operations: {},
    retiredClaimKeys: [],
    unusableRecords: {},
    hiveSessions: {},
    taskExecutions: {}
  })
}

/** Leaves an empty store a newer build wrote: this build reads it but never writes it. */
export async function seedTestAgentSessionStoreFromNewerBuild(
  stateDirectory: string
): Promise<void> {
  openTestJournalHostDatabase(stateDirectory).db.pragma(
    `user_version = ${JOURNAL_DB_SCHEMA_VERSION + 1}`
  )
  closeTestJournalHostDatabase(stateDirectory)
}

function parsed(json: unknown): unknown {
  return typeof json === 'string' ? JSON.parse(json) : null
}

export async function readPersistedTestAgentSessionStore(
  stateDirectory: string,
  options: { hostId?: string } = {}
): Promise<PersistedTestAgentSessionStore> {
  const db = databaseFor(stateDirectory)
  const persisted: PersistedTestAgentSessionStore = {
    schemaVersion: AGENT_SESSION_STORE_SCHEMA_VERSION,
    hostId: options.hostId ?? TEST_HOST_ID,
    records: {},
    operations: {},
    retiredClaimKeys: [],
    unusableRecords: {},
    hiveSessions: {},
    taskExecutions: {}
  }
  for (const row of db
    .prepare('SELECT session_id, record_json FROM agent_session_records ORDER BY rowid')
    .all()) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test read-back of rows the store wrote; a test asserting on a malformed row reads it as the value it stored.
    persisted.records[String(row.session_id)] = parsed(
      row.record_json
    ) as PersistedAgentSessionRecord
  }
  for (const row of db
    .prepare('SELECT operation_key, row_json FROM agent_session_operations ORDER BY rowid')
    .all()) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test read-back of rows the store wrote after validating them.
    persisted.operations[String(row.operation_key)] = parsed(
      row.row_json
    ) as AgentSessionOperationRow
  }
  for (const row of db
    .prepare('SELECT key_id, retired_at FROM agent_session_retired_claim_keys ORDER BY rowid')
    .all()) {
    persisted.retiredClaimKeys.push({
      keyId: String(row.key_id),
      retiredAt: Number(row.retired_at)
    })
  }
  if (
    db
      .prepare(
        "SELECT 1 AS present FROM agent_session_store_meta WHERE key = 'session_tabs_recorded'"
      )
      .get()
  ) {
    persisted.sessionTabs = db
      .prepare('SELECT tab_id, session_id FROM agent_session_tabs ORDER BY position')
      .all()
      .map((row) => ({ tabId: String(row.tab_id), sessionId: String(row.session_id) }))
  }
  const hiveState = emptyState(persisted.hostId)
  loadHiveRuntimeState(db, hiveState)
  persisted.hiveSessions = Object.fromEntries(hiveState.hiveSessions ?? [])
  persisted.taskExecutions = Object.fromEntries(hiveState.taskExecutions ?? [])
  persisted.hiveRecoveryFenceAt = hiveState.hiveRecoveryFenceAt
  persisted.taskRecoveryBlocked = hiveState.taskRecoveryBlocked
  return persisted
}

/** Everything the store has committed, as text: to assert a value never reached disk, or that an
 *  action wrote nothing by comparing two reads. */
export async function readPersistedTestAgentSessionStoreText(
  stateDirectory: string,
  options: { hostId?: string } = {}
): Promise<string> {
  return JSON.stringify(await readPersistedTestAgentSessionStore(stateDirectory, options))
}

/** Changes the committed state behind the store's back, as an older build or a damaged disk would. */
export async function editPersistedTestAgentSessionStore(
  stateDirectory: string,
  edit: (persisted: PersistedTestAgentSessionStore) => void,
  options: { hostId?: string } = {}
): Promise<void> {
  const persisted = await readPersistedTestAgentSessionStore(stateDirectory, options)
  edit(persisted)
  writePersisted(databaseFor(stateDirectory), persisted)
}
