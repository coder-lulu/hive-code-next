import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import {
  openTestJournalHostDatabase,
  closeTestJournalHostDatabases
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { legacyAgentSessionStorePath } from '../runtime/agent-session-record-store-file'
import {
  openTestAgentSessionRecordStore,
  importTestLegacyAgentSessionRecordStore,
  readPersistedTestAgentSessionStoreText
} from '../runtime/agent-session-record-store-test-harness'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { taskExecutionIdentity } from './task-execution-record'
import {
  taskCommand,
  taskWorkspace,
  taskTestDirectory,
  TASK_TEST_CALLER,
  TASK_TEST_NOW,
  TASK_TEST_LAUNCH
} from './task-execution.test-fixture'

let directory: string
let store: AgentSessionRecordStore
beforeEach(async () => {
  directory = await taskTestDirectory()
  store = await openTestAgentSessionRecordStore(directory)
})
afterEach(async () => {
  vi.restoreAllMocks()
  closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})
function admission(command = taskCommand()) {
  return {
    command,
    ...TASK_TEST_CALLER,
    workspace: taskWorkspace(directory),
    now: TASK_TEST_NOW,
    validate: () => undefined
  }
}
function anotherCommand() {
  const command = taskCommand()
  return {
    ...command,
    executionId: 'execution:another',
    operationId: `${TASK_TEST_NOW}-${'a'.repeat(32)}`,
    idempotencyKey: 'key:another',
    workspaceExecutionClaimRef: 'claim:another',
    task: { ...command.task, runId: 'run:another' }
  }
}

describe('task execution transactions in the runtime record store', () => {
  it('atomically accepts concurrent starts once and persists the same receipt', async () => {
    const starts = await Promise.all(
      Array.from({ length: 8 }, () => store.tasks.admit(admission()))
    )
    expect(starts.filter((start) => start.created)).toHaveLength(1)
    expect(new Set(starts.map((start) => start.record.accepted.receiptId)).size).toBe(1)
    const reopened = await openTestAgentSessionRecordStore(directory)
    expect(reopened.tasks.get(taskCommand())).toEqual(starts[0].record)
    expect(reopened.listOperationRows()).toEqual([])
  })
  it('serializes concurrent callers through the host single-writer queue', async () => {
    const other = store
    const starts = await Promise.all([
      store.tasks.admit(admission()),
      other.tasks.admit(admission())
    ])
    expect(starts.filter((start) => start.created)).toHaveLength(1)
  })
  it('rejects changed requirements for the same execution', async () => {
    await store.tasks.admit(admission())
    await expect(
      store.tasks.admit(admission({ ...taskCommand(), inputRef: 'input:changed' }))
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })
  it('keeps caller identity out of the transport body and partitions replay', async () => {
    await store.tasks.admit(admission())
    await expect(
      store.tasks.admit({ ...admission(), operationCallerKey: 'service:another' })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })
  it('retains the same fingerprint under renewable authorization', async () => {
    const first = await store.tasks.admit(admission())
    const next = await store.tasks.admit(
      admission({
        ...taskCommand(),
        authorizationRef: 'grant:renewed',
        expiresAt: new Date(TASK_TEST_NOW + 120_000).toISOString()
      })
    )
    expect(next.created).toBe(false)
    expect(next.record.accepted).toEqual(first.record.accepted)
  })
  it('prevents a new run from bypassing the task active slot', async () => {
    await store.tasks.admit(admission())
    await expect(store.tasks.admit(admission(anotherCommand()))).rejects.toThrow('TASK_BUSY')
  })
  it('rejects overlapping execution directories across different tasks', async () => {
    await store.tasks.admit(admission())
    const second = anotherCommand()
    second.task.taskId = 'task:another'
    await expect(store.tasks.admit(admission(second))).rejects.toThrow('WORKSPACE_BUSY')
    await expect(
      store.tasks.admit({
        ...admission(second),
        workspace: {
          ...taskWorkspace(directory),
          executionPath: `${taskWorkspace(directory).executionPath}/nested`
        }
      })
    ).rejects.toThrow('WORKSPACE_BUSY')
  })
  it('permits separate isolated copies of the same source workspace', async () => {
    await store.tasks.admit(admission())
    const second = anotherCommand()
    second.task.taskId = 'task:another'
    const result = await store.tasks.admit({
      ...admission(second),
      workspace: {
        ...taskWorkspace(directory),
        executionPath: `${taskWorkspace(directory).executionPath}-another`
      }
    })
    expect(result.created).toBe(true)
  })
  it('cancellation or unknown evidence never releases the task slot', async () => {
    await store.tasks.admit(admission())
    await store.tasks.requestCancellation(
      taskCommand(),
      'cancel:test',
      TASK_TEST_NOW,
      () => undefined
    )
    await store.tasks.markUnknown(taskCommand(), TASK_TEST_NOW)
    await expect(store.tasks.admit(admission(anotherCommand()))).rejects.toThrow('TASK_BUSY')
  })
  it('fences a cancellation before dispatch against a late launcher', async () => {
    await store.tasks.admit(admission())
    await store.tasks.requestCancellation(
      taskCommand(),
      'cancel:test',
      TASK_TEST_NOW,
      () => undefined
    )
    expect(
      (await store.tasks.beginDispatch(taskCommand(), TASK_TEST_NOW, () => undefined)).changed
    ).toBe(false)
  })
  it('binds one launch and records state and cursor in the same transaction', async () => {
    await store.tasks.admit(admission())
    await store.tasks.beginDispatch(taskCommand(), TASK_TEST_NOW, () => undefined)
    await store.tasks.bindLaunch(store.tasks.get(taskCommand())!, TASK_TEST_LAUNCH, TASK_TEST_NOW)
    const record = store.tasks.get(taskCommand())!
    expect(record.status).toBe('running')
    expect(record.events.map((event) => event.sequence)).toEqual([1, 2])
    expect((await openTestAgentSessionRecordStore(directory)).tasks.get(taskCommand())).toEqual(
      record
    )
  })
  it('does not expose an admission whose durable commit failed', async () => {
    vi.spyOn(openTestJournalHostDatabase(directory), 'transaction').mockImplementationOnce(() => {
      throw new Error('disk failure')
    })
    await expect(store.tasks.admit(admission())).rejects.toThrow('disk failure')
    expect(store.tasks.get(taskCommand())).toBeNull()
    expect((await openTestAgentSessionRecordStore(directory)).tasks.get(taskCommand())).toBeNull()
  })
  it('does not expose admission state inside the durable transaction', async () => {
    const database = openTestJournalHostDatabase(directory)
    const transaction = database.transaction.bind(database)
    vi.spyOn(database, 'transaction').mockImplementationOnce((run) => {
      expect(store.tasks.get(taskCommand())).toBeNull()
      const result = transaction(run)
      expect(store.tasks.get(taskCommand())).toBeNull()
      return result
    })
    await store.tasks.admit(admission())
    expect(store.tasks.get(taskCommand())?.status).toBe('accepted')
  })
  it('does not publish a terminal result before its durable transaction commits', async () => {
    const { record } = await store.tasks.admit(admission())
    const database = openTestJournalHostDatabase(directory)
    const transaction = database.transaction.bind(database)
    vi.spyOn(database, 'transaction').mockImplementationOnce((run) => {
      const result = transaction(run)
      expect(store.tasks.get(taskCommand())?.status).toBe('accepted')
      expect(store.tasks.get(taskCommand())?.result).toBeNull()
      return result
    })
    const settlement = store.tasks.settle(
      taskCommand(),
      {
        ...taskExecutionIdentity(record.command),
        commandFingerprint: record.commandFingerprint,
        recordedAt: new Date(TASK_TEST_NOW).toISOString(),
        kind: 'execution.result',
        status: 'failed',
        receiptId: 'result:pending',
        outcomeRef: 'outcome:pending',
        artifactRefs: [],
        usageFactRefs: [],
        stopProof: {
          proofRef: 'proof:pending',
          evidenceKind: 'not_started',
          managedToolsSettled: true,
          writersFenced: true,
          recordedAt: new Date(TASK_TEST_NOW).toISOString()
        }
      },
      TASK_TEST_NOW
    )
    await settlement
    expect(store.tasks.get(taskCommand())?.status).toBe('failed')
  })
  it('rechecks authorization inside the host journal transaction queue', async () => {
    await expect(
      store.tasks.admit({
        ...admission(),
        validate: () => {
          throw new Error('revoked')
        }
      })
    ).rejects.toThrow('revoked')
    expect(store.tasks.get(taskCommand())).toBeNull()
  })
  it('rechecks cancellation authorization before persisting its state', async () => {
    await store.tasks.admit(admission())
    await expect(
      store.tasks.requestCancellation(taskCommand(), 'cancel:revoked', TASK_TEST_NOW, () => {
        throw new Error('revoked')
      })
    ).rejects.toThrow('revoked')
    expect(store.tasks.get(taskCommand())?.cancellationKey).toBeNull()
  })
  it('retains unknown writers when the primary is recovered from an older backup', async () => {
    await store.tasks.admit(admission())
    await store.tasks.beginDispatch(taskCommand(), TASK_TEST_NOW, () => undefined)
    const migrationRoot = join(directory, 'legacy-task-recovery')
    const path = legacyAgentSessionStorePath(migrationRoot)
    await mkdir(join(migrationRoot, 'agent-sessions'), { recursive: true })
    const backup = await readPersistedTestAgentSessionStoreText(directory)
    await writeFile(`${path}.bak`, backup)
    await writeFile(path, 'corrupt-primary')
    const recovered = await importTestLegacyAgentSessionRecordStore(migrationRoot)
    await expect(recovered.tasks.admit(admission(anotherCommand()))).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    expect(recovered.tasks.get(taskCommand())).not.toBeNull()
    // Recovery rejection keeps the backup intact for the next reader.
    expect(await readFile(`${path}.bak`, 'utf8')).toBe(backup)
  })
  it('rejects cross-execution terminal receipts without changing state', async () => {
    const { record } = await store.tasks.admit(admission())
    await expect(
      store.tasks.settle(
        taskCommand(),
        {
          ...taskExecutionIdentity(record.command),
          executionId: 'execution:forged',
          commandFingerprint: record.commandFingerprint,
          recordedAt: new Date(TASK_TEST_NOW).toISOString(),
          kind: 'execution.result',
          status: 'failed',
          receiptId: 'result:forged',
          outcomeRef: 'outcome:test',
          artifactRefs: [],
          usageFactRefs: [],
          stopProof: {
            proofRef: 'proof:test',
            evidenceKind: 'not_started',
            managedToolsSettled: true,
            writersFenced: true,
            recordedAt: new Date(TASK_TEST_NOW).toISOString()
          }
        },
        TASK_TEST_NOW
      )
    ).rejects.toThrow('Invalid durable task execution binding')
    expect(store.tasks.get(taskCommand())?.status).toBe('accepted')
  })
  it('keeps generated receipt references bounded for the longest execution id', async () => {
    const { record } = await store.tasks.admit(
      admission({ ...taskCommand(), executionId: 'x'.repeat(160) })
    )
    expect(record.accepted.receiptId.length).toBeLessThanOrEqual(160)
  })
})
