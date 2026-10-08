import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_JOURNAL_SCHEMA_VERSION } from '../../../shared/agent-session-journal-types'
import { readAgentSessionHistory } from '../agent-session-wire/agent-session-history-page'
import { JournalHostDatabase } from './journal-host-database'
import { NO_LEGACY_JOURNAL_RECORDS } from './journal-database'
import {
  createPassiveAgentSessionHistoryReader,
  AgentSessionPassiveJournalError
} from './journal-passive-history'
import { insertJournalRow, publishJournalSessionEpoch } from './journal-row-table'
import { replayJournal } from './journal-open'
import { renderJournalState } from './journal-reducer'
import { insertQueuedMessage } from './queued-message-table'
import type { JournalRow } from './journal-row-schema'

const identity = { sessionId: 'original-case-journal', workspaceId: 'folder:original-workspace' }
const epoch = 'original-epoch'
let database: JournalHostDatabase
function row(seq: number, text = 'Original content'): JournalRow {
  return {
    v: AGENT_SESSION_JOURNAL_SCHEMA_VERSION,
    epoch,
    seq,
    fence: 1,
    ts: seq,
    ...(seq === 1
      ? {
          kind: 'epoch' as const,
          reason: 'session_created' as const,
          providerHandle: { kind: 'codex' as const, threadId: 'original-private-provider-thread' }
        }
      : {
          kind: 'item' as const,
          itemId: `original-item-${seq}`,
          revision: 1,
          body: {
            kind: 'message' as const,
            role: 'assistant' as const,
            blocks: [{ type: 'text' as const, text }]
          }
        })
  }
}
function seed(count = 3) {
  publishJournalSessionEpoch(database.db, identity, epoch)
  for (let seq = 1; seq <= count; seq++) {
    insertJournalRow(database.db, identity.sessionId, row(seq))
  }
}
function rows() {
  const db = database.readConnection()
  return {
    sessions: db
      .prepare('SELECT session_id, workspace_id, epoch FROM journal_sessions ORDER BY session_id')
      .all(),
    rows: db
      .prepare(
        'SELECT session_id, epoch, seq, ts, row_json FROM journal_rows ORDER BY session_id, epoch, seq'
      )
      .all(),
    repairs: db
      .prepare(
        'SELECT session_id, epoch, content_from, repaired_at FROM journal_repairs ORDER BY session_id'
      )
      .all(),
    queue: db
      .prepare(
        'SELECT session_id, message_id, state, body_json, consumed_as FROM queued_messages ORDER BY session_id, message_id'
      )
      .all(),
    imports: db
      .prepare('SELECT session_id, epoch, tip FROM journal_imports ORDER BY session_id')
      .all()
  }
}
beforeEach(async () => {
  const parent = resolve('logs/paperclip-development/20261008-case-session/tmp/passive-journal')
  await mkdir(parent, { recursive: true })
  database = JournalHostDatabase.openWith(
    await mkdtemp(join(parent, 'journal-')),
    NO_LEGACY_JOURNAL_RECORDS
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  database.close()
})

describe('pure original journal history without conversation adoption', () => {
  it('matches canonical tail/before/reset while keeping queued work and cold rows unchanged', async () => {
    seed(140)
    insertQueuedMessage(database.db, {
      sessionId: identity.sessionId,
      messageId: 'sleeping-outbox-message',
      body: {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'text', text: 'Must remain queued' }]
      },
      fingerprint: 'original-outbox-fingerprint',
      hostInstance: 'original-sleeping-host',
      queuedAt: { epoch, sequence: 140 },
      now: 1
    })
    const before = rows(),
      load = replayJournal(database.db, identity.sessionId)!
    const snapshot = renderJournalState(load.state)
    const journal = {
      isReadOnly: false,
      cursor: () => snapshot.cursor,
      snapshot: () => snapshot,
      canonicalItemId: (id: string) => id,
      readSince: () => {
        throw new Error('forward must not be read')
      }
    }
    const read = createPassiveAgentSessionHistoryReader(database),
      guard = vi.fn()
    for (const request of [
      { direction: 'tail' as const, limit: 3 },
      { direction: 'before' as const, cursor: { epoch, sequence: 135 }, limit: 2 },
      { direction: 'before' as const, cursor: { epoch: 'retired-epoch', sequence: 1 }, limit: 2 },
      { direction: 'before' as const, cursor: { epoch, sequence: 999 }, limit: 2 }
    ]) {
      expect(await read(identity, request, guard)).toEqual(
        readAgentSessionHistory(journal, { sessionId: identity.sessionId, ...request }, snapshot)
      )
    }
    expect(guard).toHaveBeenCalled()
    expect(rows()).toEqual(before)
  })
  it('missing cold journal stays missing and does not initialize an epoch', async () => {
    const before = rows()
    await expect(
      createPassiveAgentSessionHistoryReader(database)(
        identity,
        { direction: 'tail' },
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'missing' })
    expect(rows()).toEqual(before)
  })
  it('does not hand over a pending original submission or disclose a provider handle', async () => {
    seed()
    insertJournalRow(database.db, identity.sessionId, {
      v: AGENT_SESSION_JOURNAL_SCHEMA_VERSION,
      kind: 'submission',
      epoch,
      seq: 4,
      ts: 4,
      fence: 1,
      clientMessageId: 'original-pending-submission',
      payloadFingerprint: 'original-pending-fingerprint',
      providerHandle: { kind: 'codex', threadId: 'original-private-provider-thread' },
      body: {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'text', text: 'Original pending send' }]
      },
      handoverRecorded: true,
      origin: 'host'
    })
    const before = rows()
    const result = await createPassiveAgentSessionHistoryReader(database)(
      identity,
      { direction: 'tail' },
      () => undefined
    )
    expect(result.page.submissions).toMatchObject([
      {
        clientMessageId: 'original-pending-submission',
        dispatchState: 'pending',
        handoverRecorded: true
      }
    ])
    expect(result.page.submissions[0].handedOverAt).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('original-private-provider-thread')
    expect(rows()).toEqual(before)
  })
  it.each(['malformed', 'future', 'gap', 'repair', 'negative'] as const)(
    'refuses %s original rows without repair/truncation/import',
    async (condition) => {
      seed()
      if (condition === 'malformed') {
        database.db
          .prepare('UPDATE journal_rows SET row_json = ? WHERE session_id = ? AND seq = 3')
          .run('{broken', identity.sessionId)
      }
      if (condition === 'future') {
        database.db
          .prepare('UPDATE journal_rows SET row_json = ? WHERE session_id = ? AND seq = 3')
          .run(JSON.stringify({ ...row(3), v: 999 }), identity.sessionId)
      }
      if (condition === 'gap') {
        database.db
          .prepare('DELETE FROM journal_rows WHERE session_id = ? AND seq = 2')
          .run(identity.sessionId)
      }
      if (condition === 'repair') {
        database.db
          .prepare(
            'INSERT INTO journal_repairs (session_id, epoch, content_from, repaired_at) VALUES (?, ?, ?, ?)'
          )
          .run(identity.sessionId, epoch, 4, 1)
      }
      if (condition === 'negative') {
        database.db
          .prepare(
            'INSERT INTO journal_rows (session_id, epoch, seq, ts, row_json) VALUES (?, ?, ?, ?, ?)'
          )
          .run(identity.sessionId, epoch, -1, 1, JSON.stringify(row(1)))
      }
      const before = rows()
      await expect(
        createPassiveAgentSessionHistoryReader(database)(
          identity,
          { direction: 'tail' },
          () => undefined
        )
      ).rejects.toMatchObject({ code: 'unavailable' })
      expect(rows()).toEqual(before)
    }
  )
  it.each(['epoch', 'tip', 'repair', 'workspace'] as const)(
    'yields and rejects original %s drift',
    async (condition) => {
      seed(140)
      const read = createPassiveAgentSessionHistoryReader(database)
      const pending = read(identity, { direction: 'tail' }, () => undefined)
      if (condition === 'epoch') {
        publishJournalSessionEpoch(database.db, identity, 'new-epoch')
      }
      if (condition === 'tip') {
        insertJournalRow(database.db, identity.sessionId, row(141))
      }
      if (condition === 'repair') {
        database.db
          .prepare(
            'INSERT INTO journal_repairs (session_id, epoch, content_from, repaired_at) VALUES (?, ?, ?, ?)'
          )
          .run(identity.sessionId, epoch, 2, 1)
      }
      if (condition === 'workspace') {
        publishJournalSessionEpoch(
          database.db,
          { ...identity, workspaceId: 'folder:substitution' },
          epoch
        )
      }
      const before = rows()
      await expect(pending).rejects.toBeInstanceOf(AgentSessionPassiveJournalError)
      expect(rows()).toEqual(before)
    }
  )
  it('rechecks current authorization after yielding and does not hide the caller refusal', async () => {
    seed(140)
    let current = true
    const pending = createPassiveAgentSessionHistoryReader(database)(
      identity,
      { direction: 'tail' },
      () => {
        if (!current) {
          throw new Error('current-access-revoked')
        }
      }
    )
    current = false
    await expect(pending).rejects.toThrow('current-access-revoked')
  })
  it('bounds rows and bytes before materializing oversized body rows', async () => {
    seed(140)
    await expect(
      createPassiveAgentSessionHistoryReader(database, { rows: 139 })(
        identity,
        { direction: 'tail' },
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'capacity' })
    const select = vi.spyOn(database.readConnection(), 'prepare')
    await expect(
      createPassiveAgentSessionHistoryReader(database, { bytes: 128 })(
        identity,
        { direction: 'tail' },
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'capacity' })
    expect(select.mock.calls.some(([sql]) => sql.startsWith('SELECT seq, ts, row_json'))).toBe(
      false
    )
  })
  it('bounds elapsed work and at most two full folds across separately created readers', async () => {
    seed(140)
    const read1 = createPassiveAgentSessionHistoryReader(database),
      read2 = createPassiveAgentSessionHistoryReader(database)
    const first = read1(identity, { direction: 'tail' }, () => undefined)
    const second = read2(identity, { direction: 'tail' }, () => undefined)
    await expect(read2(identity, { direction: 'tail' }, () => undefined)).rejects.toMatchObject({
      code: 'capacity'
    })
    await Promise.all([first, second])
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(100)
    await expect(
      createPassiveAgentSessionHistoryReader(database, { milliseconds: 10 })(
        identity,
        { direction: 'tail' },
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'capacity' })
    now.mockRestore()
    await expect(read1(identity, { direction: 'tail' }, () => undefined)).resolves.toMatchObject({
      ok: true
    })
  })
  it('does not read or recover an open transaction', async () => {
    seed()
    const db = database.db
    db.exec('BEGIN')
    const exec = vi.spyOn(db, 'exec')
    await expect(
      createPassiveAgentSessionHistoryReader(database)(
        identity,
        { direction: 'tail' },
        () => undefined
      )
    ).rejects.toThrow('unavailable')
    expect(db.isTransaction).toBe(true)
    expect(exec).not.toHaveBeenCalled()
    exec.mockRestore()
    db.exec('ROLLBACK')
  })
  it('does not retry a stranded rollback from the passive connection accessor', () => {
    seed()
    const db = database.db,
      original = db.exec.bind(db)
    const exec = vi.spyOn(db, 'exec').mockImplementation((sql) => {
      if (sql === 'ROLLBACK') {
        throw new Error('synthetic rollback failure')
      }
      original(sql)
    })
    expect(() =>
      database.transaction(() => {
        throw new Error('synthetic failed transaction')
      })
    ).toThrow()
    exec.mockClear()
    expect(() => database.readConnection()).toThrow('unavailable')
    expect(exec).not.toHaveBeenCalled()
    expect(db.isTransaction).toBe(true)
    exec.mockRestore()
    db.exec('ROLLBACK')
  })
})
