// The host's one chat journal database: every structured chat on this state directory, in one
// file, on one connection. The app and orcad instance locks keep a second process off a profile.
//
// A chat's store owns no connection. It goes through this object, so there is nothing per chat to
// open, close, retry or leak, and the connection closes exactly once, last, at host teardown.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type Database from '../../sqlite/sync-database'
import {
  JOURNAL_SYNCHRONOUS,
  journalDatabaseMigratesRecords,
  NO_LEGACY_JOURNAL_RECORDS,
  openJournalDatabase,
  readJournalDatabaseVersion,
  runJournalTransaction,
  type JournalLegacyRecordImport,
  type OpenJournalDatabase
} from './journal-database'
import { journalOpenRefusalError } from './journal-open-failure'
import { AgentSessionJournalError } from './journal-write-guards'

const JOURNAL_DATABASE_FILE = 'agent-session-journal.db'

export function journalDatabasePath(stateDirectory: string): string {
  return join(stateDirectory, JOURNAL_DATABASE_FILE)
}

export class JournalHostDatabase {
  private readonly beforeTransactionListeners = new Set<() => void>()
  private readonly storeUnchangedListeners = new Set<() => void>()
  private connection: Database.Database | null
  /** A newer Orca wrote the database: every chat's history reads, and no chat writes. */
  readonly readOnly: boolean
  /** The chat records file could not be read this launch, so its copy waits for a later one. */
  readonly legacyRecordImportOwed: boolean
  /** A failed transaction's ROLLBACK failed too, so the transaction may still be open. */
  private stranded = false

  private constructor(
    readonly stateDirectory: string,
    opened: OpenJournalDatabase
  ) {
    this.connection = opened.db
    this.readOnly = opened.readOnly
    this.legacyRecordImportOwed = opened.legacyRecordImportOwed
  }

  /** `readLegacyRecords` runs only when this open migrates to version 4, before any transaction. */
  static async open(
    stateDirectory: string,
    readLegacyRecords: () => Promise<JournalLegacyRecordImport> = async () =>
      NO_LEGACY_JOURNAL_RECORDS
  ): Promise<JournalHostDatabase> {
    mkdirSync(stateDirectory, { recursive: true })
    const migrates = journalDatabaseMigratesRecords(
      readJournalDatabaseVersion(journalDatabasePath(stateDirectory))
    )
    return JournalHostDatabase.openWith(
      stateDirectory,
      migrates ? await readLegacyRecords() : NO_LEGACY_JOURNAL_RECORDS
    )
  }

  /** The same open with the records file already read; tests pass `NO_LEGACY_JOURNAL_RECORDS`. */
  static openWith(
    stateDirectory: string,
    legacyRecords: JournalLegacyRecordImport
  ): JournalHostDatabase {
    mkdirSync(stateDirectory, { recursive: true })
    return new JournalHostDatabase(
      stateDirectory,
      openJournalDatabase(journalDatabasePath(stateDirectory), legacyRecords)
    )
  }

  get isClosed(): boolean {
    return this.connection === null
  }

  get db(): Database.Database {
    const connection = this.connection
    if (!connection) {
      throw new AgentSessionJournalError('journal_closed', 'the chat journal database is closed')
    }
    if (this.stranded) {
      this.rollBackStrandedTransaction(connection)
    }
    return connection
  }

  /** Passive readers must not recover a transaction or observe uncommitted rows. */
  readConnection(): Database.Database {
    if (!this.connection || this.stranded || this.connection.isTransaction) {
      throw new AgentSessionJournalError('journal_closed', 'the chat journal is unavailable')
    }
    return this.connection
  }

  /** One IMMEDIATE transaction; see `runJournalTransaction`. */
  transaction<T>(run: (db: Database.Database) => T, scope?: 'journal'): T {
    const db = this.db
    if (!db.isTransaction) {
      this.beforeTransactionListeners.forEach((listener) => listener())
    }
    const result = runJournalTransaction(db, run, () => {
      this.stranded = true
    })
    if (scope === 'journal') {
      this.storeUnchangedListeners.forEach((listener) => listener())
    }
    return result
  }

  /** Synchronous preparation before BEGIN; observers never read this transaction's staged rows. */
  onBeforeTransaction(listener: () => void): () => void {
    if (this.isClosed) {
      throw new AgentSessionJournalError('journal_closed', 'the chat journal database is closed')
    }
    this.beforeTransactionListeners.add(listener)
    return () => this.beforeTransactionListeners.delete(listener)
  }

  /** Only callers whose writes are confined to journal/queued-message rows use this notification. */
  onStoreUnchangedCommit(listener: () => void): () => void {
    if (this.isClosed) {
      throw new AgentSessionJournalError('journal_closed', 'the chat journal database is closed')
    }
    this.storeUnchangedListeners.add(listener)
    return () => this.storeUnchangedListeners.delete(listener)
  }

  /**
   * The same transaction, committed without an fsync: for rows no reader follows until a later
   * synced commit, which under WAL makes every earlier frame durable too. The setting is restored
   * in the same task, so no other chat's commit runs under it.
   */
  unsyncedTransaction<T>(run: (db: Database.Database) => T): T {
    const db = this.db
    db.pragma('synchronous = NORMAL')
    try {
      return this.transaction(run)
    } finally {
      // SQLite refuses the change inside a transaction; freeing a stranded one restores it.
      if (!db.isTransaction) {
        db.pragma(`synchronous = ${JOURNAL_SYNCHRONOUS}`)
      }
    }
  }

  /** Last, after every store has drained. A close that fails keeps the handle, so the retried
   *  teardown closes this same connection. */
  close(): void {
    this.connection?.close()
    this.connection = null
    this.beforeTransactionListeners.clear()
    this.storeUnchangedListeners.clear()
  }

  /**
   * A failed transaction whose ROLLBACK failed too is still open: every later BEGIN would fail
   * inside it and every read would see rows that never committed. Each use retries the ROLLBACK,
   * and until one goes through every chat is refused the way a journal that will not open is.
   */
  private rollBackStrandedTransaction(connection: Database.Database): void {
    if (connection.isTransaction) {
      try {
        connection.exec('ROLLBACK')
      } catch (error) {
        throw journalOpenRefusalError(error)
      }
    }
    connection.pragma(`synchronous = ${JOURNAL_SYNCHRONOUS}`)
    this.stranded = false
  }
}
