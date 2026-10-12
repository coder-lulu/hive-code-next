import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from '../sqlite/sync-database'
import { journalDatabasePath } from '../native-chat/agent-session-journal/journal-host-database'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import { AGENT_SESSION_CLAIM_KEY_RETENTION_MS } from './agent-session-claim-key-retention'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStoreText
} from './agent-session-record-store-test-harness'

import type { AgentSessionReserveRequest } from './agent-session-reservation-admission'
const NOW = 1_800_000_000_000

type Outcome = 'commit' | 'rollback'
let directory: string
let store: AgentSessionRecordStore
beforeEach(async () => {
  const root = resolve('logs/paperclip-removal/backend/visibility/tmp')
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
  const request: AgentSessionReserveRequest = {
    sessionId: 'session-native-visibility',
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    provider: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: directory },
    expectedFence: null,
    spawnToken: 'native-spawn',
    claimKeyId: 'claim-key',
    handoffOperationId: `${NOW}-${'a'.repeat(32)}`,
    probe: { outcome: 'reservation-unused' },
    operation: {
      callerKey: 'native:test',
      operationId: `${NOW}-${'a'.repeat(32)}`,
      fingerprint: 'native-visibility'
    },
    now: NOW
  }
  return { request }
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
  const { request } = fixture
  return {
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
    'publishes session and operation as one version after %s',
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
        expect(after.operation?.outcome.status).toBe('pending')
        expect(after.evaluated?.decision.decision).toBe('replay')
        expect(after.records).toHaveLength(1)
        expect(after.scoped).toEqual(after.records)
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
        () => store.setSessionTabVisibility(fixture.request.sessionId, true, 'native-tab'),
        () => {
          expect(observe()).toEqual(before)
        }
      )
      expect(observe()).toEqual(
        outcome === 'commit'
          ? {
              ids: [fixture.request.sessionId],
              index: { present: true, sessionIds: [fixture.request.sessionId] },
              tab: 'native-tab'
            }
          : before
      )
    }
  )
  it.each<Outcome>(['commit', 'rollback'])(
    'does not expose retired claim-key evidence before %s',
    async (outcome) => {
      await admitted()
      const observedAt = NOW + AGENT_SESSION_CLAIM_KEY_RETENTION_MS + 1
      expect(store.isClaimKeyVerifiable('retired-key', observedAt)).toBe(true)
      await heldWrite(
        outcome,
        () => store.retireClaimKey('retired-key', NOW),
        () => {
          expect(store.isClaimKeyVerifiable('retired-key', observedAt)).toBe(true)
        }
      )
      expect(store.isClaimKeyVerifiable('retired-key', observedAt)).toBe(outcome === 'rollback')
    }
  )
})
