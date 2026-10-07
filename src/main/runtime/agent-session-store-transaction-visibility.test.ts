import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hiveAgentSessionEntrySchema } from '../../shared/hive-agent-session-entry'
import Database from '../sqlite/sync-database'
import { journalDatabasePath } from '../native-chat/agent-session-journal/journal-host-database'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { taskStructuredFixture } from '../tasks/task-structured-reservation.test-fixture'
import { taskWorkspace, TASK_TEST_NOW } from '../tasks/task-execution.test-fixture'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import { AGENT_SESSION_CLAIM_KEY_RETENTION_MS } from './agent-session-claim-key-retention'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStoreText
} from './agent-session-record-store-test-harness'

type Outcome = 'commit' | 'rollback'
let directory: string
let store: AgentSessionRecordStore
beforeEach(async () => {
  const root = resolve('logs/task-session-binding/writer-visibility/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'visibility-'))
  store = await openTestAgentSessionRecordStore(directory)
})
afterEach(async () => {
  vi.restoreAllMocks()
  closeTestJournalHostDatabase(directory)
  await rm(directory, { recursive: true, force: true })
})

async function admitted() {
  const fixture = taskStructuredFixture(taskWorkspace(directory))
  await store.tasks.admit(fixture.admission)
  await store.tasks.beginDispatch(fixture.command, TASK_TEST_NOW, fixture.validate)
  await store.admitOperation({
    callerKey: fixture.outer.callerKey,
    operationId: fixture.outer.operationId,
    fingerprint: fixture.outer.fingerprint,
    now: TASK_TEST_NOW
  })
  expect((await store.claimOperation(fixture.outer)).claim).toBe('won')
  return fixture
}

async function heldWrite(outcome: Outcome, action: () => Promise<unknown>, observe: () => void) {
  const before = await readPersistedTestAgentSessionStoreText(directory)
  const reader = new Database(journalDatabasePath(directory), {
    readonly: true,
    fileMustExist: true
  })
  const committedRows = () => [
    reader
      .prepare('SELECT session_id, record_json FROM agent_session_records ORDER BY rowid')
      .all(),
    reader
      .prepare('SELECT operation_key, row_json FROM agent_session_operations ORDER BY rowid')
      .all(),
    reader
      .prepare('SELECT key_id, retired_at FROM agent_session_retired_claim_keys ORDER BY rowid')
      .all(),
    reader
      .prepare('SELECT tab_id, session_id, position FROM agent_session_tabs ORDER BY position')
      .all(),
    reader.prepare('SELECT key, value FROM agent_session_store_meta ORDER BY key').all()
  ]
  const rowsBefore = committedRows()
  const database = openTestJournalHostDatabase(directory)
  const original = database.transaction.bind(database)
  const write = vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
    original((db) => {
      observe()
      expect(committedRows()).toEqual(rowsBefore)
      const result = run(db)
      // The SQL rows are staged, but public readers and a second connection keep the old version.
      observe()
      expect(committedRows()).toEqual(rowsBefore)
      if (outcome === 'rollback') {
        throw new Error('held-write-failed')
      }
      return result
    })
  )
  try {
    const result = await action().then(
      () => ({ ok: true, error: undefined }),
      (error: unknown) => ({ ok: false, error })
    )
    expect(write).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(outcome === 'commit')
    if (outcome === 'rollback') {
      expect(result.error).toEqual(new Error('held-write-failed'))
      observe()
      expect(committedRows()).toEqual(rowsBefore)
      expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
    } else {
      expect(committedRows()).not.toEqual(rowsBefore)
    }
  } finally {
    write.mockRestore()
    reader.close()
  }
}

function association(fixture: Awaited<ReturnType<typeof admitted>>) {
  const { request, command } = fixture
  return {
    task: store.tasks.get(command),
    tasks: store.tasks.listActive(),
    record: store.getRecord(request.sessionId),
    records: store.listRecords(),
    scoped: store.listByScope(request.location),
    operation: store.getOperationRow(request.operation.callerKey, request.operation.operationId),
    operations: store.listOperationRows(),
    evaluated: store.evaluateMutationOperation({
      callerKey: request.operation.callerKey,
      envelope: {
        sessionId: request.sessionId,
        clientOperationId: request.operation.operationId,
        expectedRuntimeFence: null,
        payloadFingerprint: request.operation.fingerprint
      },
      hostFingerprint: request.operation.fingerprint,
      now: request.now
    })
  }
}

describe('committed visibility across original store readers', () => {
  it.each<Outcome>(['commit', 'rollback'])(
    'publishes task, session and operation as one version after %s',
    async (outcome) => {
      const fixture = await admitted()
      const before = structuredClone(association(fixture))
      await heldWrite(
        outcome,
        () => store.reserveOwner(fixture.request),
        () => {
          expect(association(fixture)).toEqual(before)
        }
      )
      const after = association(fixture)
      if (outcome === 'rollback') {
        expect(after).toEqual(before)
      } else {
        expect(after.task?.revision).toBe(3)
        expect(after.task?.structuredBinding?.source).toEqual(fixture.origin.source)
        expect(after.record?.taskSource).toEqual(fixture.origin.source)
        expect(after.operation?.outcome.status).toBe('pending')
        expect(after.evaluated?.decision.decision).toBe('replay')
        expect(after.records).toHaveLength(1)
        expect(after.scoped).toEqual(after.records)
        expect(after.tasks).toEqual([after.task])
      }
    }
  )
  it.each<Outcome>(['commit', 'rollback'])(
    'keeps existing session contents committed until %s',
    async (outcome) => {
      const fixture = await admitted()
      await store.reserveOwner(fixture.request)
      const before = structuredClone(association(fixture))
      await heldWrite(
        outcome,
        () => store.setConversationName(fixture.request.sessionId, 'Committed name'),
        () => {
          expect(association(fixture)).toEqual(before)
        }
      )
      expect(store.getRecord(fixture.request.sessionId)?.conversationName).toBe(
        outcome === 'commit' ? 'Committed name' : undefined
      )
    }
  )
  it.each<Outcome>(['commit', 'rollback'])(
    'publishes the original tab index only after %s',
    async (outcome) => {
      const fixture = await admitted()
      await store.reserveOwner(fixture.request)
      const observe = () => ({
        ids: store.listVisibleSessionIds(),
        index: store.getVisibleSessionTabIndex(),
        tab: store.getSessionTabId(fixture.request.sessionId)
      })
      const before = observe()
      await heldWrite(
        outcome,
        () => store.setSessionTabVisibility(fixture.request.sessionId, true, 'task-tab'),
        () => {
          expect(observe()).toEqual(before)
        }
      )
      expect(observe()).toEqual(
        outcome === 'commit'
          ? {
              ids: [fixture.request.sessionId],
              index: { present: true, sessionIds: [fixture.request.sessionId] },
              tab: 'task-tab'
            }
          : before
      )
    }
  )
  it.each<Outcome>(['commit', 'rollback'])(
    'keeps Hive entries and their original ledger in the same version after %s',
    async (outcome) => {
      await admitted()
      const entry = hiveAgentSessionEntrySchema.parse({
        accountId: 'account:test',
        deviceId: 'device:test',
        projectScope: 'project:test',
        aggregate: {
          session: {
            schemaVersion: 1,
            sessionId: 'ha-session:c45332af-09c6-46c9-a71e-1f2ce0e825ee',
            profileId: 'personal',
            createdAt: TASK_TEST_NOW,
            updatedAt: TASK_TEST_NOW,
            visibility: 'private',
            retention: 'until-deleted',
            stateRevision: 0
          }
        }
      })
      const operation = {
        callerKey: 'hive:test',
        operationId: `${TASK_TEST_NOW}-${'e'.repeat(32)}`,
        fingerprint: 'hive-fingerprint',
        now: TASK_TEST_NOW
      }
      const id = entry.aggregate.session.sessionId
      const observe = () => ({
        entry: store.hive.get(id),
        entries: store.hive.list(),
        row: store.getOperationRow(operation.callerKey, operation.operationId),
        rows: store.listOperationRows()
      })
      const before = structuredClone(observe())
      await heldWrite(
        outcome,
        () => store.hive.commit({ entry, operation, expectedRevision: null }),
        () => {
          expect(observe()).toEqual(before)
        }
      )
      if (outcome === 'rollback') {
        expect(observe()).toEqual(before)
      } else {
        expect(store.hive.get(id)).toEqual(entry)
        expect(store.hive.list()).toEqual([entry])
        expect(store.getOperationRow(operation.callerKey, operation.operationId)?.outcome).toEqual({
          status: 'succeeded',
          sessionId: id
        })
        const next = {
          ...entry,
          aggregate: { session: { ...entry.aggregate.session, stateRevision: 1 } }
        }
        const updatedOperation = { ...operation, operationId: `${TASK_TEST_NOW}-${'f'.repeat(32)}` }
        const committed = structuredClone(observe())
        await heldWrite(
          'commit',
          () =>
            store.hive.commit({ entry: next, operation: updatedOperation, expectedRevision: 0 }),
          () => {
            expect(observe()).toEqual(committed)
          }
        )
        expect(store.hive.get(id)?.aggregate.session.stateRevision).toBe(1)
      }
    }
  )
  it.each<Outcome>(['commit', 'rollback'])(
    'does not expose retired claim-key evidence before %s',
    async (outcome) => {
      await admitted()
      const observedAt = TASK_TEST_NOW + AGENT_SESSION_CLAIM_KEY_RETENTION_MS + 1
      expect(store.isClaimKeyVerifiable('retired-key', observedAt)).toBe(true)
      await heldWrite(
        outcome,
        () => store.retireClaimKey('retired-key', TASK_TEST_NOW),
        () => {
          expect(store.isClaimKeyVerifiable('retired-key', observedAt)).toBe(true)
        }
      )
      expect(store.isClaimKeyVerifiable('retired-key', observedAt)).toBe(outcome === 'rollback')
    }
  )
})
