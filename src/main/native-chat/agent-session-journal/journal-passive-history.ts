import { setImmediate } from 'node:timers/promises'
import type { AgentJournalCursor } from '../../../shared/agent-session-journal-types'
import type { AgentSessionHistoryResult } from '../../../shared/agent-session-wire'
import type Database from '../../sqlite/sync-database'
import { readAgentSessionHistory } from '../agent-session-wire/agent-session-history-page'
import type { JournalHostDatabase } from './journal-host-database'
import { startJournalRowFold } from './journal-open'
import { renderJournalState } from './journal-reducer'
import { readJournalRowsAfter } from './journal-row-table'
import type { AgentSessionJournalReader } from './journal-store-contracts'

const ROW_BATCH_SIZE = 128
export const PASSIVE_JOURNAL_LIMITS = Object.freeze({
  rows: 20_000,
  bytes: 32 * 1024 * 1024,
  milliseconds: 5_000,
  concurrent: 2
})
export class AgentSessionPassiveJournalError extends Error {
  constructor(readonly code: 'missing' | 'unavailable' | 'changed' | 'capacity') {
    super(code)
  }
}
export type PassiveJournalHistoryRequest = {
  direction: 'tail' | 'before'
  cursor?: AgentJournalCursor
  limit?: number
}
type Head = {
  epoch: string
  workspaceId: string
  tip: number
  repair: string
  repairedFrom: number | null
}
const activeReaders = new WeakMap<JournalHostDatabase, number>()

function readHead(db: Database.Database, sessionId: string): Head {
  const row = db
    .prepare(`SELECT epoch, workspace_id FROM journal_sessions WHERE session_id = ?`)
    .get(sessionId)
  if (!row) {
    throw new AgentSessionPassiveJournalError('missing')
  }
  const tip = db
    .prepare(`SELECT max(seq) AS tip FROM journal_rows WHERE session_id = ? AND epoch = ?`)
    .get(sessionId, row.epoch)?.tip
  const first = db
    .prepare(
      `SELECT seq FROM journal_rows WHERE session_id = ? AND epoch = ? ORDER BY seq ASC LIMIT 1`
    )
    .get(sessionId, row.epoch)?.seq
  const repair = db
    .prepare(`SELECT epoch, content_from, repaired_at FROM journal_repairs WHERE session_id = ?`)
    .get(sessionId)
  if (
    typeof row.epoch !== 'string' ||
    !row.epoch ||
    typeof row.workspace_id !== 'string' ||
    !Number.isSafeInteger(tip) ||
    typeof tip !== 'number' ||
    tip < 1 ||
    first !== 1 ||
    (repair &&
      (typeof repair.epoch !== 'string' ||
        !Number.isSafeInteger(repair.content_from) ||
        Number(repair.content_from) < 1 ||
        typeof repair.repaired_at !== 'number' ||
        !Number.isFinite(repair.repaired_at)))
  ) {
    throw new AgentSessionPassiveJournalError('unavailable')
  }
  return {
    epoch: row.epoch,
    workspaceId: row.workspace_id,
    tip,
    repair: JSON.stringify(repair ?? null),
    repairedFrom: repair?.epoch === row.epoch ? Number(repair.content_from) : null
  }
}

/** Reads only the installed database; it never opens a conversation or repairs its journal. */
export function createPassiveAgentSessionHistoryReader(
  database: JournalHostDatabase,
  requestedLimits: Partial<Record<keyof typeof PASSIVE_JOURNAL_LIMITS, number>> = {}
) {
  const limits = { ...PASSIVE_JOURNAL_LIMITS, ...requestedLimits }
  for (const key of ['rows', 'bytes', 'milliseconds', 'concurrent'] as const) {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > PASSIVE_JOURNAL_LIMITS[key]
    ) {
      throw new Error('invalid passive journal bound')
    }
  }
  const resultGuards = new WeakMap<AgentSessionHistoryResult, () => void>()
  const read = async (
    identity: { sessionId: string; workspaceId: string },
    request: PassiveJournalHistoryRequest,
    assertCurrent: () => void
  ): Promise<AgentSessionHistoryResult> => {
    assertCurrent()
    if ((activeReaders.get(database) ?? 0) >= limits.concurrent) {
      throw new AgentSessionPassiveJournalError('capacity')
    }
    activeReaders.set(database, (activeReaders.get(database) ?? 0) + 1)
    try {
      if (database.readOnly) {
        throw new AgentSessionPassiveJournalError('unavailable')
      }
      const started = performance.now()
      const head = readHead(database.readConnection(), identity.sessionId)
      if (head.workspaceId !== identity.workspaceId) {
        throw new AgentSessionPassiveJournalError('changed')
      }
      if (head.tip > limits.rows) {
        throw new AgentSessionPassiveJournalError('capacity')
      }
      const guard = () => {
        assertCurrent()
        if (performance.now() - started > limits.milliseconds) {
          throw new AgentSessionPassiveJournalError('capacity')
        }
        const current = readHead(database.readConnection(), identity.sessionId)
        if (
          current.epoch !== head.epoch ||
          current.workspaceId !== head.workspaceId ||
          current.tip !== head.tip ||
          current.repair !== head.repair
        ) {
          throw new AgentSessionPassiveJournalError('changed')
        }
      }
      const fold = startJournalRowFold({
        sessionId: identity.sessionId,
        epoch: head.epoch,
        repairedFrom: head.repairedFrom
      })
      let after = 0,
        rows = 0,
        bytes = 0
      while (after < head.tip) {
        guard()
        const db = database.readConnection()
        const sizes = db
          .prepare(`SELECT seq, length(CAST(row_json AS BLOB)) AS bytes FROM journal_rows
          WHERE session_id = ? AND epoch = ? AND seq > ? ORDER BY seq ASC LIMIT ?`)
          .all(identity.sessionId, head.epoch, after, ROW_BATCH_SIZE)
        if (
          !sizes.length ||
          sizes.some(
            (row) =>
              typeof row.bytes !== 'number' || !Number.isSafeInteger(row.bytes) || row.bytes < 1
          )
        ) {
          throw new AgentSessionPassiveJournalError('unavailable')
        }
        bytes += sizes.reduce((sum, row) => sum + Number(row.bytes), 0)
        rows += sizes.length
        if (bytes > limits.bytes || rows > limits.rows) {
          throw new AgentSessionPassiveJournalError('capacity')
        }
        const batch = readJournalRowsAfter(
          db,
          identity.sessionId,
          head.epoch,
          after,
          ROW_BATCH_SIZE
        )
        if (batch.length !== sizes.length) {
          throw new AgentSessionPassiveJournalError('unavailable')
        }
        for (const row of batch) {
          if (row.seq > head.tip || !fold.add(row)) {
            throw new AgentSessionPassiveJournalError('unavailable')
          }
          if (performance.now() - started > limits.milliseconds) {
            throw new AgentSessionPassiveJournalError('capacity')
          }
        }
        after = batch.at(-1)!.seq
        await setImmediate()
        guard()
      }
      const load = fold.finish()
      if (
        load.readOnly ||
        load.corrupt ||
        load.malformedRows ||
        load.truncateFrom !== undefined ||
        load.state.lastSequence !== head.tip
      ) {
        throw new AgentSessionPassiveJournalError('unavailable')
      }
      const snapshot = renderJournalState(load.state)
      const projection: AgentSessionJournalReader = {
        isReadOnly: load.readOnly,
        cursor: () => snapshot.cursor,
        snapshot: () => snapshot,
        canonicalItemId: (itemId) => load.state.aliases.get(itemId) ?? itemId,
        readSince: () => {
          throw new AgentSessionPassiveJournalError('unavailable')
        }
      }
      const result = readAgentSessionHistory(
        projection,
        { sessionId: identity.sessionId, ...request },
        snapshot
      )
      guard()
      resultGuards.set(result, guard)
      return result
    } finally {
      activeReaders.set(database, Math.max(0, (activeReaders.get(database) ?? 1) - 1))
    }
  }
  return Object.assign(read, {
    assertCurrent(result: AgentSessionHistoryResult): void {
      const guard = resultGuards.get(result)
      if (!guard) {
        throw new AgentSessionPassiveJournalError('unavailable')
      }
      guard()
    }
  })
}
