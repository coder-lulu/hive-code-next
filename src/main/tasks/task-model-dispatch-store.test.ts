import {
  closeTestJournalHostDatabase,
  closeTestJournalHostDatabases,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskStructuredBinding } from '../../shared/task-execution/task-structured-binding'
import Database from '../sqlite/sync-database'
import {
  JournalHostDatabase,
  journalDatabasePath
} from '../native-chat/agent-session-journal/journal-host-database'
import { NO_LEGACY_JOURNAL_RECORDS } from '../native-chat/agent-session-journal/journal-database'
import { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  readPersistedTestAgentSessionStoreText
} from '../runtime/agent-session-record-store-test-harness'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskExecutionIdentity } from './task-execution-record'
import { TASK_MODEL_REQUEST_LIMIT } from './task-model-channel-protocol'
import {
  createTaskModelDispatchFixture,
  TASK_MODEL_DISPATCH_LOGS
} from './task-model-dispatch.test-fixture'

let directory: string
let fixture: Awaited<ReturnType<typeof createTaskModelDispatchFixture>>
const externalDatabases: JournalHostDatabase[] = []
beforeEach(async () => {
  const root = resolve(TASK_MODEL_DISPATCH_LOGS, 'tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'model-dispatch-'))
  fixture = await createTaskModelDispatchFixture(directory)
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const database of externalDatabases.splice(0)) {
    database.close()
  }
  closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})

async function observeSqlWrite(fail: boolean, action: () => Promise<unknown>, observe: () => void) {
  const database = openTestJournalHostDatabase(directory)
  const reader = new Database(journalDatabasePath(directory), {
    readonly: true,
    fileMustExist: true
  })
  const rows = () =>
    [
      'agent_session_records',
      'agent_session_operations',
      'agent_session_retired_claim_keys',
      'agent_session_tabs',
      'agent_session_store_meta'
    ].map((table) => reader.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
  const before = rows()
  const original = database.transaction.bind(database)
  const write = vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
    original((db) => {
      observe()
      expect(rows()).toEqual(before)
      const result = run(db)
      expect(db.isTransaction).toBe(true)
      observe()
      expect(rows()).toEqual(before)
      if (fail) {
        throw new Error('synthetic-durable-write-failure')
      }
      return result
    })
  )
  try {
    const outcome = await action().then(
      () => ({ ok: true, error: undefined }),
      (error: unknown) => ({ ok: false, error })
    )
    expect(write).toHaveBeenCalledOnce()
    expect(outcome.ok).toBe(!fail)
    if (fail) {
      expect(outcome.error).toEqual(new Error('synthetic-durable-write-failure'))
      expect(rows()).toEqual(before)
    } else {
      expect(rows()).not.toEqual(before)
    }
    return outcome
  } finally {
    write.mockRestore()
    reader.close()
  }
}

async function expectNoCommit(attempt: () => Promise<unknown>, code: string) {
  const before = await readPersistedTestAgentSessionStoreText(directory)
  const task = fixture.store.tasks.get(fixture.command)
  const session = fixture.store.getRecord(fixture.binding.sessionId)
  const operations = fixture.store.listOperationRows()
  await expect(attempt()).rejects.toThrow(code)
  expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
  expect(fixture.store.tasks.get(fixture.command)).toEqual(task)
  expect(fixture.store.getRecord(fixture.binding.sessionId)).toEqual(session)
  expect(fixture.store.listOperationRows()).toEqual(operations)
}

describe('model dispatch in the original durable Task transaction', () => {
  it('commits one debit before acknowledgement without changing status, events or Session', async () => {
    const session = fixture.store.getRecord(fixture.binding.sessionId)
    const operations = fixture.store.listOperationRows()
    const first = await fixture.reserve()
    expect(first.changed).toBe(true)
    expect(first.record).toEqual({
      ...fixture.task,
      modelDispatchAttempts: 1,
      revision: fixture.task.revision + 1
    })
    const persisted = await readPersistedTestAgentSessionStore(directory)
    expect(persisted.taskExecutions[fixture.key]).toEqual(first.record)
    expect(fixture.store.getRecord(fixture.binding.sessionId)).toEqual(session)
    expect(fixture.store.listOperationRows()).toEqual(operations)
    expect(fixture.validate).toHaveBeenCalledOnce()
    const next = await fixture.reserve()
    expect(next.record.modelDispatchAttempts).toBe(2)
    expect(next.record.events).toEqual(fixture.task.events)
    expect(next.record.revision).toBe(fixture.task.revision + 2)
  })
  it('allows the original running bound Task', async () => {
    await fixture.store.tasks.bindLaunch(
      fixture.store.tasks.get(fixture.command)!,
      fixture.launch,
      TASK_TEST_NOW
    )
    const before = fixture.store.tasks.get(fixture.command)
    const result = await fixture.reserve()
    expect(result.record.status).toBe('running')
    expect(result.record.dispatch).toBe('bound')
    expect(result.record.events).toEqual(before?.events)
    expect(result.record.modelDispatchAttempts).toBe(1)
  })
  it('serializes concurrent attempts and never exceeds the original cap', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: TASK_MODEL_REQUEST_LIMIT + 8 }, () => fixture.reserve())
    )
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(
      TASK_MODEL_REQUEST_LIMIT
    )
    for (const result of attempts) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'CAPACITY_EXCEEDED' })
      }
    }
    expect(fixture.store.tasks.get(fixture.command)).toMatchObject({
      modelDispatchAttempts: TASK_MODEL_REQUEST_LIMIT,
      revision: fixture.task.revision + TASK_MODEL_REQUEST_LIMIT,
      events: fixture.task.events
    })
    await expectNoCommit(() => fixture.reserve(), 'CAPACITY_EXCEEDED')
  })
  it.each([false, true])(
    'keeps public readers committed during a held write (failure=%s)',
    async (fail) => {
      expect(typeof fixture.store.tasks.reserveModelDispatch).toBe('function')
      const before = await readPersistedTestAgentSessionStoreText(directory)
      const snapshot = {
        task: fixture.store.tasks.get(fixture.command),
        tasks: fixture.store.tasks.listActive(),
        session: fixture.store.getRecord(fixture.binding.sessionId),
        operations: fixture.store.listOperationRows()
      }
      let acknowledged = false
      await observeSqlWrite(
        fail,
        () =>
          fixture.reserve().then((result) => {
            acknowledged = true
            return result
          }),
        () => {
          expect(acknowledged).toBe(false)
          expect(fixture.store.tasks.get(fixture.command)).toEqual(snapshot.task)
          expect(fixture.store.tasks.listActive()).toEqual(snapshot.tasks)
          expect(fixture.store.getRecord(fixture.binding.sessionId)).toEqual(snapshot.session)
          expect(fixture.store.listOperationRows()).toEqual(snapshot.operations)
        }
      )
      expect(acknowledged).toBe(!fail)
      if (fail) {
        expect(fixture.store.tasks.get(fixture.command)).toEqual(snapshot.task)
        expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
        expect((await fixture.reserve()).record.modelDispatchAttempts).toBe(1)
      } else {
        expect(fixture.store.tasks.get(fixture.command)?.modelDispatchAttempts).toBe(1)
      }
    }
  )
  it('keeps a debit after a lost durable commit acknowledgement', async () => {
    const database = openTestJournalHostDatabase(directory).db
    const original = database.exec.bind(database)
    let loseAcknowledgement = true
    vi.spyOn(database, 'exec').mockImplementation((sql) => {
      const result = original(sql)
      if (sql === 'COMMIT' && loseAcknowledgement) {
        loseAcknowledgement = false
        throw new Error('synthetic-lost-commit-acknowledgement')
      }
      return result
    })
    await expect(fixture.reserve()).rejects.toThrow('synthetic-lost-commit-acknowledgement')
    expect(fixture.store.tasks.get(fixture.command)).toEqual(fixture.task)
    expect(
      (await readPersistedTestAgentSessionStore(directory)).taskExecutions[fixture.key]
    ).toMatchObject({ modelDispatchAttempts: 1, revision: fixture.task.revision + 1 })
    await expect(fixture.reserve()).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(fixture.store.tasks.get(fixture.command)?.modelDispatchAttempts).toBe(1)
    closeTestJournalHostDatabase(directory)
    const cold = await openTestAgentSessionRecordStore(directory)
    expect(cold).not.toBe(fixture.store)
    expect(cold.tasks.get(fixture.command)?.modelDispatchAttempts).toBe(1)
    await expect(
      cold.tasks.reserveModelDispatch(fixture.binding, TASK_TEST_NOW, fixture.validate)
    ).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('preserves the counter across cold stores and matched restart probes without granting a writer', async () => {
    await fixture.reserve()
    closeTestJournalHostDatabase(directory)
    const cold = await openTestAgentSessionRecordStore(directory)
    expect(cold).not.toBe(fixture.store)
    expect(cold.tasks.get(fixture.command)?.modelDispatchAttempts).toBe(1)
    expect(cold.getRecord(fixture.binding.sessionId)?.lease.unreconciled).toBe(true)
    await expect(
      cold.tasks.reserveModelDispatch(fixture.binding, TASK_TEST_NOW, fixture.validate)
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    await cold.reconcileOnRestart({
      now: TASK_TEST_NOW,
      probe: async () => ({ outcome: 'identity-matched', matchedOn: ['spawn-token'] })
    })
    expect(cold.getRecord(fixture.binding.sessionId)?.lease.handoffStage).toBe('recovering')
    await expect(
      cold.tasks.reserveModelDispatch(fixture.binding, TASK_TEST_NOW, fixture.validate)
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    await expect(fixture.reserve()).rejects.toThrow('journal database is closed')
    expect(cold.tasks.get(fixture.command)?.modelDispatchAttempts).toBe(1)
    expect(
      (await readPersistedTestAgentSessionStore(directory)).taskExecutions[fixture.key]
        .modelDispatchAttempts
    ).toBe(1)
  })
  it('sees cancellation committed by another original Store', async () => {
    await fixture.reserve()
    const database = JournalHostDatabase.openWith(directory, NO_LEGACY_JOURNAL_RECORDS)
    externalDatabases.push(database)
    const other = AgentSessionRecordStore.open({
      journalDatabase: database,
      hostId: fixture.store.hostId
    })
    expect(other).not.toBe(fixture.store)
    await other.tasks.requestCancellation(
      fixture.command,
      'cancel:model-test',
      TASK_TEST_NOW,
      fixture.validate
    )
    await expect(fixture.reserve()).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(fixture.store.tasks.get(fixture.command)).toMatchObject({
      status: 'cancel_requested',
      modelDispatchAttempts: 1
    })
  })
  it('rejects an original Task with unknown outcome without another debit', async () => {
    await fixture.reserve()
    await fixture.store.tasks.markUnknown(fixture.command, TASK_TEST_NOW, fixture.validate)
    await expectNoCommit(() => fixture.reserve(), 'OUTCOME_UNKNOWN')
  })
  it('rejects a settled original Task while preserving its consumed counter', async () => {
    await fixture.reserve()
    await fixture.store.tasks.settle(
      fixture.command,
      {
        ...taskExecutionIdentity(fixture.command),
        commandFingerprint: fixture.task.commandFingerprint,
        recordedAt: new Date(TASK_TEST_NOW).toISOString(),
        kind: 'execution.result',
        status: 'failed',
        receiptId: 'result:model-test',
        outcomeRef: 'outcome:model-test',
        artifactRefs: [],
        usageFactRefs: [],
        stopProof: {
          proofRef: 'proof:model-test',
          evidenceKind: 'stopped',
          managedToolsSettled: true,
          writersFenced: true,
          recordedAt: new Date(TASK_TEST_NOW).toISOString()
        }
      },
      TASK_TEST_NOW
    )
    await expectNoCommit(() => fixture.reserve(), 'OUTCOME_UNKNOWN')
    expect(fixture.store.tasks.get(fixture.command)?.modelDispatchAttempts).toBe(1)
  })
  it.each([undefined, null, 'callback', 0])(
    'rejects a missing or malformed current guard %s',
    async (value) => {
      const request = { validate: fixture.validate }
      Object.assign(request, { validate: value })
      const missing = structuredClone(fixture.binding)
      missing.source.executionId = 'execution:missing'
      await expectNoCommit(
        () => fixture.store.tasks.reserveModelDispatch(missing, TASK_TEST_NOW, request.validate),
        'INVALID_REQUEST'
      )
    }
  )
  it.each(['promise', 'rejection', 'value', 'null'])(
    'rejects a non-void synchronous guard result %s',
    async (mode) => {
      const rejected = Promise.reject(new Error('synthetic-async-denial'))
      void rejected.catch(() => undefined)
      const validate = vi.fn(() => {
        if (mode === 'promise') {
          return Promise.resolve()
        }
        if (mode === 'rejection') {
          return rejected
        }
        if (mode === 'value') {
          return true
        }
        return null
      })
      const missing = structuredClone(fixture.binding)
      missing.source.executionId = 'execution:missing'
      await expectNoCommit(
        () => fixture.store.tasks.reserveModelDispatch(missing, TASK_TEST_NOW, validate),
        'FORBIDDEN'
      )
      expect(validate).toHaveBeenCalledOnce()
    }
  )
  it('checks the current grant before looking up a missing Task', async () => {
    const binding = structuredClone(fixture.binding)
    binding.source.executionId = 'execution:missing'
    const validate = vi.fn(() => {
      throw new Error('synthetic-current-grant-revoked')
    })
    await expectNoCommit(
      () => fixture.store.tasks.reserveModelDispatch(binding, TASK_TEST_NOW, validate),
      'synthetic-current-grant-revoked'
    )
    expect(validate).toHaveBeenCalledOnce()
  })
  it('rechecks authorization after waiting for the original queue', async () => {
    expect(typeof fixture.store.tasks.reserveModelDispatch).toBe('function')
    const rename = fixture.store.setConversationName(fixture.binding.sessionId, 'model-fixture')
    let revoked = false
    const validate = vi.fn(() => {
      expect(fixture.store.getRecord(fixture.binding.sessionId)?.conversationName).toBe(
        'model-fixture'
      )
      if (revoked) {
        throw new Error('synthetic-current-grant-revoked')
      }
    })
    const result = fixture.reserve(validate).catch((error: unknown) => error)
    expect(validate).not.toHaveBeenCalled()
    revoked = true
    await rename
    expect(await result).toMatchObject({ message: 'synthetic-current-grant-revoked' })
    expect(fixture.store.tasks.get(fixture.command)?.modelDispatchAttempts).toBeUndefined()
    expect(validate).toHaveBeenCalledOnce()
  })
  it('snapshots the immutable binding before waiting for the original queue', async () => {
    expect(typeof fixture.store.tasks.reserveModelDispatch).toBe('function')
    const rename = fixture.store.setConversationName(fixture.binding.sessionId, 'model-fixture')
    const binding = structuredClone(fixture.binding)
    const result = fixture.store.tasks.reserveModelDispatch(
      binding,
      TASK_TEST_NOW,
      fixture.validate
    )
    binding.source.commandFingerprint = 'a'.repeat(64)
    binding.accountHome.path = resolve(directory, 'foreign-home')
    binding.sessionId = 'foreign_session'
    expect(fixture.validate).not.toHaveBeenCalled()
    await rename
    expect((await result).record.modelDispatchAttempts).toBe(1)
    expect(fixture.store.tasks.get(fixture.command)?.structuredBinding).toEqual(fixture.binding)
  })
  const forks: [string, (binding: TaskStructuredBinding) => void][] = [
    [
      'ownership epoch',
      (binding) => {
        binding.source.ownershipEpoch += 1
      }
    ],
    [
      'fingerprint',
      (binding) => {
        binding.source.commandFingerprint = 'a'.repeat(64)
      }
    ],
    [
      'caller',
      (binding) => {
        binding.operationCallerKey = 'acct-runtime:foreign'
      }
    ],
    [
      'outer operation',
      (binding) => {
        binding.operationId = `${TASK_TEST_NOW}-${'f'.repeat(32)}`
      }
    ],
    [
      'launch fingerprint',
      (binding) => {
        binding.launchFingerprint = 'a'.repeat(64)
      }
    ],
    [
      'attach operation',
      (binding) => {
        binding.attachOperationId = `${TASK_TEST_NOW}-${'f'.repeat(32)}`
      }
    ],
    [
      'attach fingerprint',
      (binding) => {
        binding.attachFingerprint = 'a'.repeat(64)
      }
    ],
    [
      'session',
      (binding) => {
        binding.sessionId = 'foreign_session'
      }
    ],
    [
      'fence',
      (binding) => {
        binding.runtimeFence += 1
      }
    ],
    [
      'spawn token',
      (binding) => {
        binding.spawnToken = 'foreign-spawn'
      }
    ],
    [
      'home',
      (binding) => {
        binding.accountHome.path = resolve(directory, 'foreign-home')
      }
    ],
    [
      'workspace',
      (binding) => {
        binding.location.workspaceId = 'foreign-workspace'
      }
    ],
    [
      'workspace kind',
      (binding) => {
        binding.location.workspaceKind = 'git-worktree'
      }
    ]
  ]
  it.each(forks)('rejects a fork of the original %s without a debit', async (_label, fork) => {
    const binding = structuredClone(fixture.binding)
    fork(binding)
    await expectNoCommit(
      () => fixture.store.tasks.reserveModelDispatch(binding, TASK_TEST_NOW, fixture.validate),
      'IDEMPOTENCY_CONFLICT'
    )
  })
  it.each([undefined, null, {}, { source: null }])(
    'rejects malformed binding data %s without invoking authority',
    async (value) => {
      const request = { binding: fixture.binding }
      Object.assign(request, { binding: value })
      await expectNoCommit(
        () =>
          fixture.store.tasks.reserveModelDispatch(
            request.binding,
            TASK_TEST_NOW,
            fixture.validate
          ),
        'INVALID_REQUEST'
      )
      expect(fixture.validate).not.toHaveBeenCalled()
    }
  )
})
