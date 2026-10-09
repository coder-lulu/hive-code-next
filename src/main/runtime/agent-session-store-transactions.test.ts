// How a record-store write reaches the chat database: only the rows it changed, each checked with
// the rules a load applies, never inside a caller's own transaction, and never in memory unless the
// rows committed.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from '../sqlite/sync-database'
import { journalDatabasePath } from '../native-chat/agent-session-journal/journal-host-database'
import * as recordRows from './agent-session-record-rows'
import {
  createUnconfirmedTaskSqlFixture,
  writeExternalTaskCounter
} from './agent-session-store-ack-loss.test-fixture'
import { JournalRowWriter } from '../native-chat/agent-session-journal/journal-row-writer'
import { JournalWriteQueue } from '../native-chat/agent-session-journal/journal-write-queue'
import type { JournalRow } from '../native-chat/agent-session-journal/journal-row-schema'
import { AGENT_SESSION_JOURNAL_SCHEMA_VERSION } from '../../shared/agent-session-journal-types'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  closeTestJournalHostDatabases,
  openTestJournalHostDatabase,
  publishTestJournalEpoch
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  storedTestAgentSessionRecord
} from './agent-session-record-store-test-harness'
import { claudeProviderHandle } from '../../shared/agent-session-provider-handle-encoding'

const NOW = 1_800_000_000_000

let root: string
let counter = 0

beforeEach(async () => {
  const evidence = resolve('logs/main-merge/runtime-author/transactions/tmp')
  await mkdir(evidence, { recursive: true })
  root = await mkdtemp(join(evidence, 'store-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  closeTestJournalHostDatabases()
  await rm(root, { recursive: true, force: true })
})

/** Reserve, observe the spawn, prove the handle: a chat with a live writer. */
async function liveChat(
  store: AgentSessionRecordStore,
  sessionId: string
): Promise<AgentSessionRecord> {
  counter += 1
  const reserved = await store.reserveOwner({
    sessionId,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'git-worktree'
    },
    provider: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/home/dev/.claude' },
    expectedFence: null,
    spawnToken: `spawn-${counter}`,
    claimKeyId: 'key-1',
    handoffOperationId: null,
    probe: { outcome: 'reservation-unused' },
    operation: {
      callerKey: 'client-1',
      operationId: `${NOW}-${String(counter).padStart(32, '0')}`,
      fingerprint: `fp-${counter}`
    },
    now: NOW
  })
  const fence = reserved.record.lease.runtimeFence
  await store.commitProcessIdentity({
    sessionId,
    fence,
    process: {
      hostId: 'local',
      pid: 4000 + counter,
      processStartTimeMs: NOW,
      spawnToken: `spawn-${counter}`
    },
    now: NOW
  })
  return store.proveOwner({
    sessionId,
    fence,
    link: {
      linkId: `link-${counter}`,
      handle: claudeProviderHandle(`provider-${counter}`, null),
      origin: 'created',
      mintedAtFence: fence,
      observedAt: NOW
    },
    now: NOW
  })
}

function totalChanges(): number {
  return Number(
    openTestJournalHostDatabase(root).db.prepare('SELECT total_changes() AS n').get()?.n ?? 0
  )
}

describe('writing a transaction', () => {
  it('writes one record row for a renewal of one chat among several', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    await liveChat(store, 'chat-a-0001')
    await liveChat(store, 'chat-b-0002')
    const renewed = await liveChat(store, 'chat-c-0003')
    const before = totalChanges()

    await store.renewLease({
      sessionId: 'chat-c-0003',
      fence: renewed.lease.runtimeFence,
      childProbe: { outcome: 'identity-matched', matchedOn: ['spawn-token'] },
      now: NOW + 10_000
    })

    expect(totalChanges() - before).toBe(1)
    expect(
      (await openTestAgentSessionRecordStore(root)).getRecord('chat-c-0003')?.lease.lastRenewedAt
    ).toBe(NOW + 10_000)
  })

  it('writes nothing for a transaction that changes nothing', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    await liveChat(store, 'chat-a-0001')
    const before = totalChanges()

    await store.renewLeases([])

    expect(totalChanges()).toBe(before)
  })

  // Every mutation lands after the caller's frame, so one made inside an open journal transaction
  // on the same connection never nests a BEGIN there.
  it('runs a store call made inside an open journal transaction after that transaction', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    await liveChat(store, 'chat-a-0001')
    let pending: Promise<unknown> | null = null

    openTestJournalHostDatabase(root).transaction(() => {
      pending = store.setConversationName('chat-a-0001', 'renamed')
    })

    await expect(pending).resolves.toMatchObject({ conversationName: 'renamed' })
    expect((await readPersistedTestAgentSessionStore(root)).records['chat-a-0001']).toMatchObject({
      conversationName: 'renamed'
    })
  })
})

describe('a receipt', () => {
  const operationId = `${NOW}-${'7'.repeat(32)}`
  const outcome = { status: 'succeeded' as const, sessionId: 'chat-a-0001' }

  async function pendingOperation(): Promise<AgentSessionRecordStore> {
    const store = await openTestAgentSessionRecordStore(root)
    await liveChat(store, 'chat-a-0001')
    await store.admitOperation({ callerKey: 'client-1', operationId, fingerprint: 'fp', now: NOW })
    return store
  }

  async function persistedStatus(): Promise<string | undefined> {
    const reopened = await openTestAgentSessionRecordStore(root)
    return reopened.getOperationRow('client-1', operationId)?.outcome.status
  }

  // Written inside the caller's journal transaction, so it commits or rolls back with that write.
  it('shows its rows in memory only once committed is called after the commit', async () => {
    const store = await pendingOperation()
    const receipt = store.operationOutcomeReceipt({ callerKey: 'client-1', operationId, outcome })

    openTestJournalHostDatabase(root).transaction((db) => {
      receipt.write(db)
      expect(store.getOperationRow('client-1', operationId)?.outcome.status).toBe('pending')
    })
    expect(store.getOperationRow('client-1', operationId)?.outcome.status).toBe('pending')
    expect(await persistedStatus()).toBe('succeeded')

    receipt.committed()
    expect(store.getOperationRow('client-1', operationId)?.outcome).toEqual(outcome)
  })

  it('leaves memory and rows as they were when the transaction rolls back', async () => {
    const store = await pendingOperation()
    const receipt = store.operationOutcomeReceipt({ callerKey: 'client-1', operationId, outcome })

    expect(() =>
      openTestJournalHostDatabase(root).transaction((db) => {
        receipt.write(db)
        throw new Error('the journal row was refused')
      })
    ).toThrow('the journal row was refused')

    expect(store.getOperationRow('client-1', operationId)?.outcome.status).toBe('pending')
    expect(await persistedStatus()).toBe('pending')
    // The next store transaction diffs from what committed, not from the discarded draft.
    await store.setConversationName('chat-a-0001', 'after')
    expect(await persistedStatus()).toBe('pending')
  })
})

describe('a change a load would refuse', () => {
  it('rejects a tab id that could not prefix a pane key, and keeps memory and rows as they were', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    await liveChat(store, 'chat-a-0001')
    const persisted = await readPersistedTestAgentSessionStore(root)

    await expect(
      store.setSessionTabVisibility('chat-a-0001', true, 'agent-session:chat-a-0001')
    ).rejects.toThrow('agent_session_store_write_invalid')

    expect(store.getSessionTabId('chat-a-0001')).toBeNull()
    expect(store.getVisibleSessionTabIndex().present).toBe(false)
    expect(await readPersistedTestAgentSessionStore(root)).toEqual(persisted)
  })

  it('rejects a record whose handle chain names a link twice', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    const before = await liveChat(store, 'chat-a-0001')

    await expect(
      store.transitionHandoff('chat-a-0001', (record) => ({
        ...record,
        providerHandleChain: [...record.providerHandleChain, ...record.providerHandleChain]
      }))
    ).rejects.toThrow('agent_session_store_write_invalid')

    expect(store.getRecord('chat-a-0001')).toBe(before)
    expect(
      (await openTestAgentSessionRecordStore(root)).getRecord('chat-a-0001')?.providerHandleChain
    ).toHaveLength(1)
  })
})

describe('rows in memory', () => {
  it('throws on a change made in place, which the row diff would never write', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    await liveChat(store, 'chat-a-0001')
    const loaded = (await openTestAgentSessionRecordStore(root)).getRecord('chat-a-0001')

    expect(() => Object.assign(loaded?.lease ?? {}, { runtimeFence: 99 })).toThrow(TypeError)
    expect(() =>
      Object.assign(store.getRecord('chat-a-0001') ?? {}, { conversationName: 'x' })
    ).toThrow(TypeError)
  })
})

describe('after the database closes', () => {
  // Late settlement at quit lands here: the caller reports it, and nothing in memory moves.
  it('refuses a write with journal_closed and leaves memory as it was', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    const before = await liveChat(store, 'chat-a-0001')
    closeTestJournalHostDatabases()

    await expect(store.setConversationName('chat-a-0001', 'late')).rejects.toMatchObject({
      code: 'journal_closed'
    })
    expect(store.getRecord('chat-a-0001')).toBe(before)
  })
})

describe('one published store per live host database', () => {
  it.each([
    'commit',
    'commit-reused-error',
    'commit-quarantine-retry',
    'rollback',
    'rollback-external',
    'rollback-external-task'
  ])('verifies failed Task SQL before the next business callback (%s)', async (kind) => {
    const { fixture, database, persisted } = await createUnconfirmedTaskSqlFixture(
      root,
      kind.startsWith('commit'),
      kind === 'commit-reused-error'
    )
    const owner = fixture.store.getRecord(fixture.binding.sessionId)
    await expect(fixture.reserve()).rejects.toThrow('task-sql-unconfirmed')
    expect(fixture.store.tasks.get(fixture.command)).toEqual(fixture.task)
    expect((await persisted()).taskExecutions[fixture.key].modelDispatchAttempts).toBe(
      kind.startsWith('commit') ? 1 : undefined
    )
    const callback = vi.fn()
    if (kind.startsWith('commit')) {
      if (kind === 'commit-quarantine-retry') {
        const transaction = database.transaction.bind(database)
        vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
          transaction((db) => {
            run(db)
            throw new Error('quarantine-write-failed')
          })
        )
        await expect(fixture.reserve(callback)).rejects.toThrow('quarantine-write-failed')
        expect(callback).not.toHaveBeenCalled()
        expect((await persisted()).taskExecutions[fixture.key].modelDispatchAttempts).toBe(1)
      }
      await expect(fixture.reserve(callback)).rejects.toThrow('OUTCOME_UNKNOWN')
      expect(callback).not.toHaveBeenCalled()
      expect(await persisted()).toMatchObject({ taskRecoveryBlocked: true })
      expect((await persisted()).taskExecutions[fixture.key].modelDispatchAttempts).toBe(1)
    } else {
      if (kind.startsWith('rollback-external')) {
        await writeExternalTaskCounter(root, kind === 'rollback-external-task')
      }
      expect((await fixture.reserve(callback)).record.modelDispatchAttempts).toBe(
        kind === 'rollback-external-task' ? 2 : 1
      )
      expect(callback).toHaveBeenCalledOnce()
      expect((await persisted()).taskRecoveryBlocked).not.toBe(true)
      expect(fixture.store.getRecord(fixture.binding.sessionId)).toBe(owner)
      expect(owner?.lease.unreconciled).toBe(false)
    }
  })

  it('appends 32 real journal rows without full store reloads, but detects external and unknown-hook writes', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    const original = await liveChat(store, 'chat-a-0001')
    const database = openTestJournalHostDatabase(root)
    publishTestJournalEpoch(database.db, original.sessionId, 'stream-epoch')
    await store.renewLeases([])
    const queue = new JournalWriteQueue(original.sessionId)
    let sequence = 1
    const writer = new JournalRowWriter({
      sessionId: original.sessionId,
      now: () => NOW,
      serialize: (run) => queue.serialize(run),
      database: () => database,
      readOnly: () => false,
      highestFence: () => 1,
      nextSequence: () => sequence,
      commit: (row) => {
        sequence = row.seq + 1
      }
    })
    const row = (seq: number, ts: number): JournalRow => ({
      v: AGENT_SESSION_JOURNAL_SCHEMA_VERSION,
      epoch: 'stream-epoch',
      seq,
      ts,
      fence: 1,
      kind: 'item',
      itemId: `stream-item-${seq}`,
      revision: 1,
      body: { kind: 'status', text: 'stream' }
    })
    const load = vi.spyOn(recordRows, 'loadAgentSessionStoreRows')
    for (let count = 0; count < 32; count++) {
      await writer.enqueue(row)
    }
    expect(sequence).toBe(33)
    expect(load).not.toHaveBeenCalled()
    expect(store.getRecord(original.sessionId)).toBe(original)
    const outsider = new Database(journalDatabasePath(root), { fileMustExist: true })
    try {
      outsider
        .prepare('UPDATE agent_session_records SET record_json = ? WHERE session_id = ?')
        .run(
          JSON.stringify(
            storedTestAgentSessionRecord({ ...original, conversationName: 'external' })
          ),
          original.sessionId
        )
      await writer.enqueue(row)
      expect(load).toHaveBeenCalledOnce()
      expect(store.getRecord(original.sessionId)?.conversationName).toBe('external')
      expect(store.getRecord(original.sessionId)?.lease.unreconciled).toBe(true)
    } finally {
      outsider.close()
    }
    load.mockClear()
    await writer.enqueue(row, (db) => {
      db.prepare('UPDATE agent_session_records SET record_json = ? WHERE session_id = ?').run(
        JSON.stringify(
          storedTestAgentSessionRecord({
            ...store.getRecord(original.sessionId)!,
            conversationName: 'unknown-hook'
          })
        ),
        original.sessionId
      )
    })
    await store.renewLeases([])
    expect(load).toHaveBeenCalledOnce()
    expect(store.getRecord(original.sessionId)?.conversationName).toBe('unknown-hook')
    const acknowledged = vi.fn()
    const unsubscribe = database.onStoreUnchangedCommit(acknowledged)
    const transaction = database.transaction.bind(database)
    vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
      transaction((db) => {
        run(db)
        throw new Error('stream-rollback')
      }, 'journal')
    )
    const before = sequence
    try {
      await expect(writer.enqueue(row)).rejects.toThrow('stream-rollback')
      expect(sequence).toBe(before)
      expect(acknowledged).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })

  it('shares the original business stores and writer queue across repeated opens', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    await liveChat(store, 'chat-a-0001')
    const other = await openTestAgentSessionRecordStore(root)
    expect(other).toBe(store)
    expect(other.tasks).toBe(store.tasks)
    expect(other.hive).toBe(store.hive)
    await Promise.all([
      store.setConversationName('chat-a-0001', 'first'),
      other.setConversationName('chat-a-0001', 'second')
    ])
    expect(store.getRecord('chat-a-0001')?.conversationName).toBe('second')
    closeTestJournalHostDatabases()
    const restarted = await openTestAgentSessionRecordStore(root)
    expect(restarted).not.toBe(store)
    expect(restarted.tasks).not.toBe(store.tasks)
  })

  it('skips row reloads while SQL is unchanged and preserves identity after an unrelated write', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    const record = await liveChat(store, 'chat-a-0001')
    const load = vi.spyOn(recordRows, 'loadAgentSessionStoreRows')
    await store.renewLeases([])
    await store.renewLeases([])
    expect(load).not.toHaveBeenCalled()
    openTestJournalHostDatabase(root).transaction((db) => {
      db.prepare('INSERT INTO agent_session_store_meta (key, value) VALUES (?, ?)').run(
        'unrelated-test-row',
        '1'
      )
    })
    await store.renewLeases([])
    expect(load).toHaveBeenCalledOnce()
    expect(store.getRecord(record.sessionId)).toBe(record)
    expect(record.lease.unreconciled).toBe(false)
    await store.renewLeases([])
    expect(load).toHaveBeenCalledOnce()
  })

  it('keeps receipt staging unpublished when unrelated journal rows change the SQL counter', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    await liveChat(store, 'chat-a-0001')
    const operationId = `${NOW}-${'9'.repeat(32)}`
    await store.admitOperation({
      callerKey: 'client-1',
      operationId,
      fingerprint: 'receipt',
      now: NOW
    })
    const receipt = store.operationOutcomeReceipt({
      callerKey: 'client-1',
      operationId,
      outcome: { status: 'succeeded', sessionId: 'chat-a-0001' }
    })
    openTestJournalHostDatabase(root).transaction((db) => {
      db.prepare('INSERT INTO agent_session_store_meta (key, value) VALUES (?, ?)').run(
        'journal-test-row',
        '1'
      )
      receipt.write(db)
      expect(store.getOperationRow('client-1', operationId)?.outcome.status).toBe('pending')
    })
    expect(store.getOperationRow('client-1', operationId)?.outcome.status).toBe('pending')
    receipt.committed()
    expect(store.getOperationRow('client-1', operationId)?.outcome.status).toBe('succeeded')
  })

  it('refuses an external commit between preparation and BEGIN without publishing its staged draft', async () => {
    const store = await openTestAgentSessionRecordStore(root)
    const before = await liveChat(store, 'chat-a-0001')
    const outsider = new Database(journalDatabasePath(root), { fileMustExist: true })
    let once = true
    const unsubscribe = openTestJournalHostDatabase(root).onBeforeTransaction(() => {
      if (once) {
        once = false
        outsider
          .prepare('INSERT INTO agent_session_store_meta (key, value) VALUES (?, ?)')
          .run('external-test-row', '1')
      }
    })
    try {
      await expect(store.setConversationName(before.sessionId, 'stale')).rejects.toThrow()
      expect(store.getRecord(before.sessionId)).toBe(before)
      expect((await readPersistedTestAgentSessionStore(root)).records[before.sessionId]).toEqual(
        storedTestAgentSessionRecord(before)
      )
    } finally {
      unsubscribe()
      outsider.close()
    }
    await store.setConversationName(before.sessionId, 'current')
    expect(store.getRecord(before.sessionId)?.conversationName).toBe('current')
  })
})
