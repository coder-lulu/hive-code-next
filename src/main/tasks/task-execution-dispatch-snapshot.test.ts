import { rm } from 'node:fs/promises'
import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import {
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore
} from '../runtime/agent-session-record-store-test-harness'
import { taskStructuredFixture } from './task-structured-reservation.test-fixture'
import { taskTestDirectory, taskWorkspace, TASK_TEST_NOW } from './task-execution.test-fixture'
import {
  TaskExecutionRecordSchema,
  taskExecutionRecordKey,
  type TaskExecutionRecord
} from './task-execution-record'
import { prepareTaskExecutionLaunchAuthorization } from './task-execution-launch-authorization'
import { taskAdapterFixture } from './task-adapter.test-fixture'
import { recoverPersistedTaskExecution } from './task-execution-recovery'

let directory: string
beforeEach(async () => {
  directory = await taskTestDirectory()
})
afterEach(async () => {
  vi.restoreAllMocks()
  closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})

async function writeReplacement(directory: string, original: TaskExecutionRecord, changed: string) {
  await editPersistedTestAgentSessionStore(directory, (primary) => {
    const command = {
      ...original.command,
      ownershipEpoch: original.command.ownershipEpoch + (changed === 'ownership' ? 1 : 0)
    }
    const operationCallerKey =
      changed === 'caller' ? 'acct-runtime:replacement' : original.operationCallerKey
    const commandFingerprint = computeTaskExecutionFingerprint(command, operationCallerKey)
    primary.taskExecutions[taskExecutionRecordKey(original.command)] =
      TaskExecutionRecordSchema.parse({
        ...original,
        command,
        operationCallerKey,
        commandFingerprint,
        workspace:
          changed === 'workspace'
            ? { ...original.workspace, canonicalPath: join(directory, 'replacement') }
            : original.workspace,
        accepted: {
          ...original.accepted,
          ownershipEpoch: command.ownershipEpoch,
          commandFingerprint
        },
        events: original.events.map((event) => ({
          ...event,
          ownershipEpoch: command.ownershipEpoch,
          commandFingerprint
        }))
      })
  })
}

describe('original execution mutations retain the authorized snapshot under the file lock', () => {
  it.each(['ownership', 'caller', 'workspace'])(
    'does not mark a replacement %s Task dispatching under an earlier authorization',
    async (changed) => {
      const fixture = taskStructuredFixture(taskWorkspace(directory))
      const store = await openTestAgentSessionRecordStore(directory)
      await store.tasks.admit(fixture.admission)
      const original = store.tasks.get(fixture.command)!
      await writeReplacement(directory, original, changed)
      const assertCurrent = vi.fn(() => undefined)
      const outcome = await prepareTaskExecutionLaunchAuthorization(
        { store: store.tasks, now: () => TASK_TEST_NOW },
        original,
        { workspace: original.workspace, input: 'original private input', assertCurrent }
      ).catch((error) => error)
      const durable = (await openTestAgentSessionRecordStore(directory)).tasks.get(fixture.command)!
      expect(durable.dispatch).toBe('not_dispatched')
      expect(durable.status).toBe('accepted')
      expect(durable.launch).toBeNull()
      expect(outcome).toBeInstanceOf(Error)
      expect(outcome.message).toBe('IDEMPOTENCY_CONFLICT')
      expect(assertCurrent).not.toHaveBeenCalled()
    }
  )
  it.each(['ownership', 'caller', 'workspace'])(
    'does not overwrite a replacement %s Task when the old host dispatch fails',
    async (changed) => {
      const current = await taskAdapterFixture()
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const begin = current.store.tasks.beginDispatch.bind(current.store.tasks)
      vi.spyOn(current.store.tasks, 'beginDispatch').mockImplementation(async (...args) => {
        entered.resolve()
        await release.promise
        return begin(...args)
      })
      try {
        await current.client.start(current.binding.command, current.binding.commandFingerprint)
        await entered.promise
        const original = current.store.tasks.get(current.binding.command)!
        await writeReplacement(current.directory, original, changed)
        release.resolve()
        await current.host.drain()
        const durable = (await openTestAgentSessionRecordStore(current.directory)).tasks.get(
          current.binding.command
        )!
        expect(durable.status).toBe('accepted')
        expect(durable.dispatch).toBe('not_dispatched')
        expect(durable.cancellationKey).toBeNull()
        expect(durable.result).toBeNull()
        expect(current.deps.launch).not.toHaveBeenCalled()
      } finally {
        release.resolve()
        await current.close()
      }
    }
  )
  it('does not mark a replacement running Task unknown after an old stop observation fails', async () => {
    const current = await taskAdapterFixture()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    current.deps.collect = vi.fn(async () => ({ outcomeRef: 'outcome:original', artifactRefs: [] }))
    current.deps.stop = vi.fn(async () => {
      entered.resolve()
      await release.promise
      return null
    })
    try {
      await current.client.start(current.binding.command, current.binding.commandFingerprint)
      await current.host.drain()
      const original = current.store.tasks.get(current.binding.command)!
      const reconciliation = current.client.reconcile(current.query).catch((error) => error)
      await entered.promise
      await writeReplacement(current.directory, original, 'ownership')
      release.resolve()
      const outcome = await reconciliation
      const durable = (await openTestAgentSessionRecordStore(current.directory)).tasks.get(
        current.binding.command
      )!
      expect(durable.status).toBe('running')
      expect(durable.result).toBeNull()
      expect(durable.cancellationKey).toBeNull()
      expect(outcome.message).toBe('IDEMPOTENCY_CONFLICT')
    } finally {
      release.resolve()
      await current.close()
    }
  })
  it('does not mark a replacement Task unknown from a stale recovery snapshot', async () => {
    const fixture = taskStructuredFixture(taskWorkspace(directory))
    const store = await openTestAgentSessionRecordStore(directory)
    await store.tasks.admit(fixture.admission)
    await store.tasks.beginDispatch(fixture.command, TASK_TEST_NOW, fixture.validate)
    const original = store.tasks.get(fixture.command)!
    await writeReplacement(directory, original, 'ownership')
    const settle = vi.fn(async () => undefined)
    const outcome = await recoverPersistedTaskExecution({
      store: store.tasks,
      read: () => store.tasks.get(fixture.command)!,
      isLaunching: () => false,
      now: () => TASK_TEST_NOW,
      validate: () => undefined,
      assertAuthorized: () => undefined,
      launchFingerprint: null,
      settle,
      cancelRevoked: async () => undefined
    }).catch((error) => error)
    const durable = (await openTestAgentSessionRecordStore(directory)).tasks.get(fixture.command)!
    expect(durable.status).toBe('accepted')
    expect(durable.result).toBeNull()
    expect(outcome.message).toBe('IDEMPOTENCY_CONFLICT')
    expect(settle).not.toHaveBeenCalled()
  })
  it('does not attach a completed original launch to an immutable replacement Task', async () => {
    const current = await taskAdapterFixture()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const launch = current.deps.launch
    current.deps.launch = vi.fn(async (...args: Parameters<typeof launch>) => {
      entered.resolve()
      await release.promise
      return launch(...args)
    })
    try {
      await current.client.start(current.binding.command, current.binding.commandFingerprint)
      await entered.promise
      const original = current.store.tasks.get(current.binding.command)!
      await writeReplacement(current.directory, original, 'ownership')
      release.resolve()
      await current.host.drain()
      const durable = (await openTestAgentSessionRecordStore(current.directory)).tasks.get(
        current.binding.command
      )!
      expect(durable.launch).toBeNull()
      expect(durable.dispatch).toBe('dispatching')
      expect(durable.status).toBe('accepted')
      expect(durable.result).toBeNull()
    } finally {
      release.resolve()
      await current.close()
    }
  })
})
