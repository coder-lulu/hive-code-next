import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as durableWrite from '../durable-file-write'
import {
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  readPersistedTestAgentSessionStoreText,
  testAgentSessionStoreFilePath
} from '../runtime/agent-session-record-store-test-harness'
import { taskFailure, taskFailureSummary } from './task-failure-diagnostic'
import { createTaskModelDispatchFixture } from './task-model-dispatch.test-fixture'
import { TASK_TEST_NOW, taskCapabilities } from './task-execution.test-fixture'
import { TaskExecutionHost } from './task-execution-host'
import { TaskExecutionError } from './task-execution-error'
import { installTaskAuthorizationMonitor } from './task-authorization-monitor'
import { taskExecutionIdentity } from './task-execution-record'

let directory: string
let f: Awaited<ReturnType<typeof createTaskModelDispatchFixture>>
beforeEach(async () => {
  const root = resolve('logs/paperclip-development/p3/task-model-failure-diagnostics/writer/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'failure-'))
  f = await createTaskModelDispatchFixture(directory, { bound: true })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})
const failure = () => taskFailure(undefined, 'response', 'TASK_MODEL_LIMIT_UNAVAILABLE', 429)
const recordFailure = () => f.store.tasks.recordModelFailure(f.task, failure(), TASK_TEST_NOW)

describe('first safe failure in the original Task event transaction', () => {
  it.each(['command', 'workspace', 'caller'])(
    'refuses a swapped original %s without a fallback cancellation write',
    async (changed) => {
      const host = new TaskExecutionHost({
        store: f.store.tasks,
        capabilities: () => taskCapabilities(f.command),
        authorize: vi.fn(),
        launch: vi.fn(),
        collect: vi.fn(),
        stop: vi.fn(),
        now: () => TASK_TEST_NOW
      })
      const original = structuredClone(f.task)
      const caller = { operationCallerKey: original.operationCallerKey }
      if (changed === 'command') {
        original.command.authorizationRevision += ':replacement'
      }
      if (changed === 'workspace') {
        await editPersistedTestAgentSessionStore(directory, (state) => {
          state.taskExecutions[f.key].workspace.canonicalPath += '-replacement'
        })
      }
      if (changed === 'caller') {
        caller.operationCallerKey = 'foreign-caller'
      }
      const before = await readPersistedTestAgentSessionStoreText(directory)
      await expect(
        host.fenceRevokedExecution(
          original,
          caller,
          taskFailure(
            new TaskExecutionError('FORBIDDEN'),
            'authorization_monitor',
            'OUTCOME_UNKNOWN'
          )
        )
      ).rejects.toThrow()
      expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
    }
  )
  it('preserves original revocation cleanup when Session diagnostic provenance is unavailable', async () => {
    const host = new TaskExecutionHost({
      store: f.store.tasks,
      capabilities: () => taskCapabilities(f.command),
      authorize: vi.fn(),
      launch: vi.fn(),
      collect: vi.fn(),
      stop: vi.fn(),
      now: () => TASK_TEST_NOW
    })
    await editPersistedTestAgentSessionStore(directory, (state) => {
      state.records[f.binding.sessionId].accountHome = {
        variable: 'CODEX_HOME',
        path: resolve(directory, 'replacement-home')
      }
    })
    await host.fenceRevokedExecution(
      f.task,
      { operationCallerKey: f.task.operationCallerKey },
      taskFailure(new TaskExecutionError('FORBIDDEN'), 'authorization_monitor', 'OUTCOME_UNKNOWN')
    )
    const task = f.store.tasks.get(f.command)!
    expect(task.cancellationKey).toBe(`revoked:${f.task.commandFingerprint}`)
    expect(task.status).toBe('cancel_requested')
    expect(
      task.events.some((event) => event.summary?.startsWith('Task authorization failure:'))
    ).toBe(false)
    await expect(recordFailure()).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })
  it('persists only the first model cause across competing stores without changing execution evidence', async () => {
    const other = await openTestAgentSessionRecordStore(directory)
    const session = f.store.getRecord(f.binding.sessionId)
    const operations = f.store.listOperationRows()
    const outcomes = await Promise.all([
      recordFailure(),
      other.tasks.recordModelFailure(
        f.task,
        taskFailure(undefined, 'channel', 'TASK_MODEL_REQUEST_ABORTED'),
        TASK_TEST_NOW
      )
    ])
    expect(outcomes.filter((outcome) => outcome.changed)).toHaveLength(1)
    const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.key]
    const summary = task.events.at(-1)?.summary
    expect([
      taskFailureSummary('model', failure()),
      taskFailureSummary('model', taskFailure(undefined, 'channel', 'TASK_MODEL_REQUEST_ABORTED'))
    ]).toContain(summary)
    expect(task).toEqual({ ...f.task, revision: f.task.revision + 1, events: task.events })
    expect(task.events).toHaveLength(f.task.events.length + 1)
    const currentSession = f.store.getRecord(f.binding.sessionId)!
    // A competing cold store may set its existing recovery marker; owner proof stays intact.
    expect(currentSession).toEqual({
      ...session,
      lease: { ...session!.lease, unreconciled: currentSession.lease.unreconciled }
    })
    expect(f.store.listOperationRows()).toEqual(operations)
    await f.store.tasks.readActive(() => undefined)
    await recordFailure()
    expect(f.store.tasks.get(f.command)?.events).toEqual(task.events)
  })

  it('can record original evidence after cancellation settles without altering terminal proof or usage', async () => {
    await f.store.tasks.requestCancellation(f.command, 'original-stop', TASK_TEST_NOW, f.validate)
    const result = {
      ...taskExecutionIdentity(f.command),
      commandFingerprint: f.task.commandFingerprint,
      recordedAt: new Date(TASK_TEST_NOW).toISOString(),
      kind: 'execution.result' as const,
      receiptId: 'result:cancelled',
      outcomeRef: 'outcome:cancelled',
      status: 'cancelled' as const,
      artifactRefs: [],
      usageFactRefs: [],
      stopProof: {
        proofRef: 'proof:stopped',
        evidenceKind: 'stopped' as const,
        managedToolsSettled: true as const,
        writersFenced: true as const,
        recordedAt: new Date(TASK_TEST_NOW).toISOString()
      }
    }
    await f.store.tasks.settle(f.command, result, TASK_TEST_NOW)
    const before = f.store.tasks.get(f.command)!
    await recordFailure()
    const after = f.store.tasks.get(f.command)!
    expect(after).toEqual({ ...before, revision: before.revision + 1, events: after.events })
    expect(after.result).toEqual(result)
    expect(after.events.at(-1)).toMatchObject({
      status: 'cancelled',
      summary: taskFailureSummary('model', failure())
    })
    await expect(f.reserve()).rejects.toThrow('OUTCOME_UNKNOWN')
  })

  it.each(['workspace', 'caller', 'binding', 'session', 'session-fence'])(
    'rejects a raced original %s replacement before writing diagnostics',
    async (changed) => {
      await editPersistedTestAgentSessionStore(directory, (state) => {
        if (changed === 'workspace') {
          state.taskExecutions[f.key].workspace.canonicalPath += '-replacement'
        } else if (changed === 'session') {
          state.records[f.binding.sessionId].accountHome = {
            variable: 'CODEX_HOME',
            path: resolve(directory, 'other-home')
          }
        } else if (changed === 'session-fence') {
          state.records[f.binding.sessionId].lease.runtimeFence++
        }
      })
      const expected = structuredClone(f.task)
      if (changed === 'caller') {
        expected.operationCallerKey = 'different-caller'
      }
      if (changed === 'binding') {
        expected.structuredBinding!.spawnToken = 'different-spawn-token'
      }
      const before = await readPersistedTestAgentSessionStoreText(directory)
      await expect(
        f.store.tasks.recordModelFailure(expected, failure(), TASK_TEST_NOW)
      ).rejects.toThrow()
      expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
    }
  )

  it('does not publish a diagnostic when the durable write fails and permits an exact retry', async () => {
    const before = await readPersistedTestAgentSessionStoreText(directory)
    vi.spyOn(durableWrite, 'writeTempFileDurable').mockRejectedValueOnce(
      new Error('synthetic private disk failure')
    )
    await expect(recordFailure()).rejects.toThrow('synthetic private disk failure')
    expect(f.store.tasks.get(f.command)).toEqual(f.task)
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
    await recordFailure()
    expect(f.store.tasks.get(f.command)?.events.at(-1)?.summary).toBe(
      taskFailureSummary('model', failure())
    )
  })

  it('refuses a read-only newer store and recovered backup diagnostic writes', async () => {
    const path = testAgentSessionStoreFilePath(directory)
    const persisted = await readPersistedTestAgentSessionStore(directory)
    await writeFile(path, JSON.stringify({ ...persisted, schemaVersion: 99 }))
    const readonly = await openTestAgentSessionRecordStore(directory)
    await expect(
      readonly.tasks.recordModelFailure(f.task, failure(), TASK_TEST_NOW)
    ).rejects.toThrow('agent_session_legacy_required')
    const future = await readPersistedTestAgentSessionStoreText(directory)
    expect(JSON.parse(future).schemaVersion).toBe(99)
    await writeFile(path, JSON.stringify(persisted))
    await writeFile(`${path}.bak`, JSON.stringify(persisted))
    await writeFile(path, '{invalid')
    const recovered = await openTestAgentSessionRecordStore(directory)
    await expect(
      recovered.tasks.recordModelFailure(f.task, failure(), TASK_TEST_NOW)
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(recovered.tasks.get(f.command)?.events).toEqual(f.task.events)
  })

  it('keeps the Native issuer reason in the cancellation event before slow recovery', async () => {
    const host = new TaskExecutionHost({
      store: f.store.tasks,
      capabilities: () => taskCapabilities(f.command),
      authorize: vi.fn(),
      launch: vi.fn(),
      collect: vi.fn(),
      stop: vi.fn(),
      now: () => TASK_TEST_NOW
    })
    let release!: () => void
    const held = new Promise<void>((resolveHold) => {
      release = resolveHold
    })
    const recover = vi.fn(async () => held)
    const monitor = installTaskAuthorizationMonitor({
      store: f.store.tasks,
      host: {
        fenceRevokedExecution: host.fenceRevokedExecution.bind(host),
        recoverPersistedExecution: recover
      },
      issuer: {
        assertExecutionCurrent: () => {
          throw new TaskExecutionError('FORBIDDEN')
        },
        launchFingerprint: () => null,
        restoreBindings: async () => ({ restored: 0, unavailable: 0 })
      },
      operationCallerKey: f.task.operationCallerKey,
      assertCurrent: () => undefined,
      subscribe: () => () => undefined
    })
    try {
      await vi.waitFor(() => expect(recover).toHaveBeenCalled())
      const cancelled = f.store.tasks.get(f.command)!
      expect(cancelled.cancellationKey).toBe(`revoked:${f.task.commandFingerprint}`)
      expect(cancelled.events.at(-1)?.summary).toBe(
        'Task authorization failure: {"phase":"authorization_monitor","category":"authorization","code":"FORBIDDEN"}'
      )
      await host.fenceRevokedExecution(
        f.task,
        { operationCallerKey: f.task.operationCallerKey },
        taskFailure(
          new Error('private URL/token secret'),
          'authorization_monitor',
          'OUTCOME_UNKNOWN'
        )
      )
      expect(f.store.tasks.get(f.command)).toEqual(cancelled)
      expect(JSON.stringify(cancelled.events)).not.toContain('secret')
    } finally {
      release()
      await monitor.close()
    }
  })
})
