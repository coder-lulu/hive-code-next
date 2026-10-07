import {
  closeTestJournalHostDatabase,
  closeTestJournalHostDatabases,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { taskExecutionRecordKey } from './task-execution-record'
import { TASK_MODEL_REQUEST_LIMIT } from './task-model-channel-protocol'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { createTaskModelDispatchFixture } from './task-model-dispatch.test-fixture'
import {
  finishModelRequest,
  modelBrokerFixture,
  modelStartParams
} from './task-model-broker.test-fixture'

let directory: string
const channels: ReturnType<typeof modelBrokerFixture>[] = []
const externalDatabases: JournalHostDatabase[] = []
type Source = Awaited<ReturnType<typeof createTaskModelDispatchFixture>>
beforeEach(async () => {
  const root = resolve('logs/paperclip-development/p3/model-pre-debit/broker/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'original-store-'))
})

afterEach(async () => {
  for (const channel of channels.splice(0)) {
    await channel.channel.close()
  }
  vi.restoreAllMocks()
  for (const database of externalDatabases.splice(0)) {
    database.close()
  }
  closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})

async function source(bound = false) {
  return createTaskModelDispatchFixture(directory, { bound, codexHome: resolve(directory, 'home') })
}

function broker(owner: Source, overrides: Parameters<typeof modelBrokerFixture>[0] = {}) {
  const f = modelBrokerFixture({
    authScope: {
      codexHome: owner.binding.accountHome.path,
      sessionId: owner.binding.sessionId,
      providerAccountId: 'fixture-account'
    },
    assertCurrent: owner.validate,
    reserveDispatch: async () => {
      await owner.reserve()
    },
    ...overrides
  })
  channels.push(f)
  return f
}

function deferred() {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('broker pre-debit in the original durable Task store', () => {
  it.each([false, true])('commits before credentials for bound=%s', async (bound) => {
    const owner = await source(bound)
    const before = owner.store.tasks.get(owner.command)
    const f = broker(owner)
    f.readAuth.mockImplementation(async () => {
      const disk = await readPersistedTestAgentSessionStore(directory)
      expect(disk.taskExecutions[owner.key].modelDispatchAttempts).toBe(1)
      expect(owner.store.tasks.get(owner.command)?.modelDispatchAttempts).toBe(1)
      return { Authorization: 'Bearer offline_fixture', 'ChatGPT-Account-Id': 'fixture-account' }
    })
    const params = modelStartParams()
    await f.channel.start(params)
    await finishModelRequest(f.channel, params.requestId)
    const after = owner.store.tasks.get(owner.command)
    expect(after?.revision).toBe((before?.revision ?? 0) + 1)
    expect(after?.events).toEqual(before?.events)
    expect(after?.status).toBe(before?.status)
    expect(f.request).toHaveBeenCalledTimes(1)
  })

  it('enforces one durable cap across newly constructed channels', async () => {
    const owner = await source()
    for (let count = 1; count <= TASK_MODEL_REQUEST_LIMIT; count++) {
      const f = broker(owner)
      const params = modelStartParams()
      await f.channel.start(params)
      await finishModelRequest(f.channel, params.requestId)
      await f.channel.close()
      expect(owner.store.tasks.get(owner.command)?.modelDispatchAttempts).toBe(count)
    }
    const diskBefore = await readPersistedTestAgentSessionStoreText(directory)
    const rejected = broker(owner)
    await expect(rejected.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_BUDGET_REFUSED'
    )
    expect(rejected.readAuth).not.toHaveBeenCalled()
    expect(rejected.request).not.toHaveBeenCalled()
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(diskBefore)
  })

  it.each(['commit', 'rollback'] as const)(
    'does not read credentials while the original %s write is held',
    async (outcome) => {
      const owner = await source()
      const before = owner.store.tasks.get(owner.command)
      const diskBefore = await readPersistedTestAgentSessionStoreText(directory)
      const entered = deferred()
      const held = deferred()
      const reader = new Database(journalDatabasePath(directory), {
        readonly: true,
        fileMustExist: true
      })
      const rows = () => reader.prepare('SELECT key, value FROM agent_session_store_meta').all()
      const committed = rows()
      const database = openTestJournalHostDatabase(directory)
      const transaction = database.transaction.bind(database)
      const write = vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
        transaction((db) => {
          const result = run(db)
          expect(db.isTransaction).toBe(true)
          expect(owner.store.tasks.get(owner.command)).toEqual(before)
          expect(rows()).toEqual(committed)
          expect(f.readAuth).not.toHaveBeenCalled()
          expect(f.request).not.toHaveBeenCalled()
          if (outcome === 'rollback') {
            throw new Error('pre-debit-write-failed')
          }
          return result
        })
      )
      const f = broker(owner, {
        reserveDispatch: async () => {
          entered.release()
          await held.promise
          await owner.reserve()
        }
      })
      const params = modelStartParams()
      const attempt = f.channel.start(params).then(
        (value) => ({ ok: true, value }),
        (error: unknown) => ({ ok: false, error })
      )
      try {
        await Promise.race([
          entered.promise,
          attempt.then(() => {
            throw new Error('original write was never held')
          })
        ])
        expect(owner.store.tasks.get(owner.command)).toEqual(before)
        expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(diskBefore)
        expect(f.readAuth).not.toHaveBeenCalled()
        expect(f.request).not.toHaveBeenCalled()
        held.release()
        expect((await attempt).ok).toBe(outcome === 'commit')
        expect(write).toHaveBeenCalledOnce()
        if (outcome === 'commit') {
          await finishModelRequest(f.channel, params.requestId)
          expect(f.request).toHaveBeenCalledTimes(1)
        } else {
          expect(f.readAuth).not.toHaveBeenCalled()
          expect(f.request).not.toHaveBeenCalled()
          expect(owner.store.tasks.get(owner.command)).toEqual(before)
          expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(diskBefore)
        }
      } finally {
        held.release()
        await attempt
        write.mockRestore()
        reader.close()
      }
    }
  )

  it('closes a held debit without reading credentials when its commit completes late', async () => {
    const owner = await source()
    const held = deferred()
    const entered = deferred()
    const committed = deferred()
    const f = broker(owner, {
      reserveDispatch: async () => {
        entered.release()
        await held.promise
        await owner.reserve()
        committed.release()
      }
    })
    const started = f.channel.start(modelStartParams())
    const rejected = expect(started).rejects.toThrow('TASK_MODEL_REQUEST_ABORTED')
    try {
      await entered.promise
      await f.channel.close()
      await rejected
      expect(f.readAuth).not.toHaveBeenCalled()
      held.release()
      await committed.promise
      expect(owner.store.tasks.get(owner.command)?.modelDispatchAttempts).toBe(1)
      expect(f.readAuth).not.toHaveBeenCalled()
      expect(f.request).not.toHaveBeenCalled()
    } finally {
      held.release()
      await started.catch(() => undefined)
    }
  })

  it('burns a committed attempt when acknowledgement is lost and refuses cold reuse', async () => {
    const owner = await source()
    const f = broker(owner, {
      reserveDispatch: async () => {
        await owner.reserve()
        throw new Error('lost pre-debit acknowledgement')
      }
    })
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_UPSTREAM_UNAVAILABLE'
    )
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_CHANNEL_UNAVAILABLE'
    )
    closeTestJournalHostDatabase(directory)
    const cold = await openTestAgentSessionRecordStore(directory)
    expect(cold).not.toBe(owner.store)
    expect(cold.tasks.get(owner.command)?.modelDispatchAttempts).toBe(1)
    const reused = broker(owner, {
      reserveDispatch: async () => {
        await cold.tasks.reserveModelDispatch(owner.binding, TASK_TEST_NOW, owner.validate)
      }
    })
    await expect(reused.channel.start(modelStartParams())).rejects.toThrow(/^TASK_MODEL_/)
    expect(reused.readAuth).not.toHaveBeenCalled()
    expect(reused.request).not.toHaveBeenCalled()
    expect(cold.tasks.get(owner.command)?.modelDispatchAttempts).toBe(1)
  })

  it('retains the debit after an upstream dispatch fails without refund or retry', async () => {
    const owner = await source()
    const f = broker(owner)
    f.request.mockRejectedValue(new Error('synthetic dispatch failure'))
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_UPSTREAM_UNAVAILABLE'
    )
    expect(f.request).toHaveBeenCalledTimes(1)
    expect(owner.store.tasks.get(owner.command)?.modelDispatchAttempts).toBe(1)
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_CHANNEL_UNAVAILABLE'
    )
    closeTestJournalHostDatabase(directory)
    const cold = await openTestAgentSessionRecordStore(directory)
    expect(cold).not.toBe(owner.store)
    expect(cold.tasks.get(owner.command)?.modelDispatchAttempts).toBe(1)
  })

  it('refreshes original cancellation before debit and cannot fetch under stale cached data', async () => {
    const owner = await source()
    const database = JournalHostDatabase.openWith(directory, NO_LEGACY_JOURNAL_RECORDS)
    externalDatabases.push(database)
    const other = AgentSessionRecordStore.open({
      journalDatabase: database,
      hostId: owner.store.hostId
    })
    expect(other).not.toBe(owner.store)
    await other.tasks.requestCancellation(
      owner.command,
      'cancel:other',
      TASK_TEST_NOW,
      owner.validate
    )
    const before = await readPersistedTestAgentSessionStoreText(directory)
    const f = broker(owner)
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(/^TASK_MODEL_/)
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    expect(owner.store.tasks.get(owner.command)?.modelDispatchAttempts).toBeUndefined()
    expect(owner.store.tasks.get(owner.command)?.cancellationKey).toBe('cancel:other')
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
  })

  it('keeps the original source key and does not expose a counter as an authority receipt', async () => {
    const owner = await source()
    const f = broker(owner)
    const params = modelStartParams()
    const reply = await f.channel.start(params)
    expect(reply).toEqual({ status: 200, contentType: 'text/event-stream' })
    await finishModelRequest(f.channel, params.requestId)
    const persisted = await readPersistedTestAgentSessionStore(directory)
    expect(Object.keys(persisted.taskExecutions)).toEqual([taskExecutionRecordKey(owner.command)])
    expect(persisted.taskExecutions[owner.key].structuredBinding).toEqual(owner.binding)
  })
})
