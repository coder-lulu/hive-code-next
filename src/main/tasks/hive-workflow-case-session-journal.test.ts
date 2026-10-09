import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENT_SESSION_JOURNAL_SCHEMA_VERSION } from '../../shared/agent-session-journal-types'
import { JournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database'
import { NO_LEGACY_JOURNAL_RECORDS } from '../native-chat/agent-session-journal/journal-database'
import { createPassiveAgentSessionHistoryReader } from '../native-chat/agent-session-journal/journal-passive-history'
import {
  insertJournalRow,
  publishJournalSessionEpoch
} from '../native-chat/agent-session-journal/journal-row-table'
import { workflowCaseSessionFixture } from './hive-workflow-case-session.test-fixture'
import { createLocalTaskSessionInspection } from './local-task-session-inspection'

let database: JournalHostDatabase
const epoch = 'original-case-epoch'
beforeEach(async () => {
  const parent = resolve(
    'logs/paperclip-development/20261008-case-session/tmp/session-journal-composition'
  )
  await mkdir(parent, { recursive: true })
  database = JournalHostDatabase.openWith(
    await mkdtemp(join(parent, 'journal-')),
    NO_LEGACY_JOURNAL_RECORDS
  )
})
afterEach(() => database.close())

function composedFixture() {
  const f = workflowCaseSessionFixture()
  const identity = { sessionId: f.session!.sessionId, workspaceId: f.record!.workspace.workspaceId }
  publishJournalSessionEpoch(database.db, identity, epoch)
  const anchor = {
    v: AGENT_SESSION_JOURNAL_SCHEMA_VERSION,
    kind: 'epoch' as const,
    epoch,
    seq: 1,
    ts: 1,
    fence: 1,
    reason: 'session_created' as const,
    providerHandle: { kind: 'codex' as const, threadId: 'original-private-thread' }
  }
  insertJournalRow(database.db, identity.sessionId, anchor)
  insertJournalRow(database.db, identity.sessionId, {
    v: AGENT_SESSION_JOURNAL_SCHEMA_VERSION,
    kind: 'item',
    epoch,
    seq: 2,
    ts: 2,
    fence: 1,
    itemId: 'original-message',
    revision: 1,
    body: {
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'Authentic synthetic journal body' }]
    }
  })
  const reader = createPassiveAgentSessionHistoryReader(database)
  const inspection = createLocalTaskSessionInspection({
    resources: {
      journalDatabase: database,
      store: { getRecord: f.source.readSession, tasks: { get: f.source.readExecution } }
    },
    store: { getFolderWorkspace: () => undefined },
    currentRuntime: f.source.currentRuntime,
    assertCurrent: f.source.assertCurrent
  })
  f.source.readHistory = inspection.readHistory
  f.source.assertHistoryCurrent = inspection.assertHistoryCurrent
  return { ...f, original: f, identity, reader, anchor }
}

describe('original journal head survives final Case authorization rereads', () => {
  it('returns genuine original journal content with no recursive guard or writer', async () => {
    const f = composedFixture()
    const page = await f.facade().getWorkflowCaseSessionPage(f.query)
    expect(page.history.ok).toBe(true)
    expect(page.history.page.items[0].body).toEqual({
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'Authentic synthetic journal body' }]
    })
    expect(page.history.page.latestTurn).toBeNull()
  })
  it('publishes the original running turn from the canonical real journal reader', async () => {
    const f = composedFixture()
    insertJournalRow(database.db, f.identity.sessionId, {
      ...f.anchor,
      kind: 'item',
      seq: 3,
      itemId: 'original-running-turn',
      revision: 1,
      body: { kind: 'turn', turnId: 'original-turn', state: 'running', startedAt: 1 }
    })
    const before = database
      .readConnection()
      .prepare('SELECT row_json FROM journal_rows WHERE session_id = ? ORDER BY seq')
      .all(f.identity.sessionId)
    const page = await f.facade().getWorkflowCaseSessionPage(f.query)
    expect(page.history.ok).toBe(true)
    expect(page.history.page.latestTurn).toEqual({
      itemId: 'original-running-turn',
      observedAt: 1,
      turn: { turnId: 'original-turn', state: 'running', startedAt: 1 }
    })
    expect(
      database
        .readConnection()
        .prepare('SELECT row_json FROM journal_rows WHERE session_id = ? ORDER BY seq')
        .all(f.identity.sessionId)
    ).toEqual(before)
  })
  it.each(['epoch', 'tip', 'repair', 'workspace'] as const)(
    'refuses %s drift during final Case read',
    async (condition) => {
      const f = composedFixture()
      let cases = 0
      f.original.onRequest = (path) => {
        if (path !== 'case' || ++cases !== 2) {
          return
        }
        if (condition === 'epoch') {
          publishJournalSessionEpoch(database.db, f.identity, 'replaced-epoch')
          insertJournalRow(database.db, f.identity.sessionId, {
            ...f.anchor,
            epoch: 'replaced-epoch'
          })
        }
        if (condition === 'tip') {
          insertJournalRow(database.db, f.identity.sessionId, { ...f.anchor, seq: 3 })
        }
        if (condition === 'repair') {
          database.db
            .prepare(
              'INSERT INTO journal_repairs (session_id, epoch, content_from, repaired_at) VALUES (?, ?, ?, ?)'
            )
            .run(f.identity.sessionId, epoch, 3, 1)
        }
        if (condition === 'workspace') {
          publishJournalSessionEpoch(
            database.db,
            { ...f.identity, workspaceId: 'folder:repointed' },
            epoch
          )
        }
      }
      await expect(f.facade().getWorkflowCaseSessionPage(f.query)).rejects.toThrow(
        'OUTCOME_UNKNOWN'
      )
      expect(cases).toBe(2)
    }
  )
  it('rejects a history result not produced by this installed reader', async () => {
    const f = composedFixture()
    const history = await f.reader(f.identity, { direction: 'tail' }, () => undefined)
    const other = createPassiveAgentSessionHistoryReader(database)
    expect(() => other.assertCurrent(history)).toThrow('unavailable')
    expect(() => f.reader.assertCurrent(structuredClone(history))).toThrow('unavailable')
    expect(() => f.reader.assertCurrent(history)).not.toThrow()
  })
})
