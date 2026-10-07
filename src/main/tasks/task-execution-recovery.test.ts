import { rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from '../sqlite/sync-database'
import {
  JournalHostDatabase,
  journalDatabasePath
} from '../native-chat/agent-session-journal/journal-host-database'
import { NO_LEGACY_JOURNAL_RECORDS } from '../native-chat/agent-session-journal/journal-database'
import {
  closeTestJournalHostDatabase,
  closeTestJournalHostDatabases,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { TaskExecutionHost } from './task-execution-host'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import type { AgentSessionOperationOutcome } from '../../shared/agent-session-operation-ledger'
import { taskExecutionIdentity, type TaskExecutionRecord } from './task-execution-record'
import {
  taskCommand,
  taskWorkspace,
  taskTestDirectory,
  TASK_TEST_CALLER,
  TASK_TEST_NOW,
  TASK_TEST_LAUNCH,
  taskCapabilities,
  taskStopEvidence
} from './task-execution.test-fixture'

let directory: string
let store: AgentSessionRecordStore
const externalConnections: { close(): void }[] = []
const fingerprint = 'original-launch-fingerprint'
const command = () => taskCommand({ operationId: `${TASK_TEST_NOW}-${'a'.repeat(32)}` })
beforeEach(async () => {
  directory = await taskTestDirectory()
  store = await openTestAgentSessionRecordStore(directory)
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const database of externalConnections.splice(0)) {
    database.close()
  }
  closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})
const admit = () =>
  store.tasks.admit({
    command: command(),
    ...TASK_TEST_CALLER,
    workspace: taskWorkspace(directory),
    now: TASK_TEST_NOW,
    validate: () => undefined
  })
async function dispatched() {
  await admit()
  await store.tasks.beginDispatch(command(), TASK_TEST_NOW, () => undefined)
  await store.tasks.markUnknown(command(), TASK_TEST_NOW)
}
async function operation(
  outcome: AgentSessionOperationOutcome,
  callerKey = TASK_TEST_CALLER.operationCallerKey,
  operationId = command().operationId
) {
  await store.admitOperation({ callerKey, operationId, fingerprint, now: TASK_TEST_NOW })
  await store.recordOperationOutcome({ callerKey, operationId, outcome })
}
const succeeded = (): AgentSessionOperationOutcome => ({
  status: 'succeeded',
  sessionId: '',
  launch: TASK_TEST_LAUNCH
})
const recover = () =>
  store.tasks.recoverLaunch(
    store.tasks.get(command())!,
    fingerprint,
    TASK_TEST_NOW,
    () => undefined
  )
function observeSqlWrite(observe: () => void, fail = false) {
  const reader = new Database(journalDatabasePath(directory), {
    readonly: true,
    fileMustExist: true
  })
  externalConnections.push(reader)
  const rows = () => [
    reader.prepare('SELECT key, value FROM agent_session_store_meta ORDER BY key').all(),
    reader
      .prepare('SELECT operation_key, row_json FROM agent_session_operations ORDER BY rowid')
      .all()
  ]
  const before = rows()
  const database = openTestJournalHostDatabase(directory)
  const transaction = database.transaction.bind(database)
  return vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
    transaction((db) => {
      observe()
      expect(rows()).toEqual(before)
      const result = run(db)
      expect(db.isTransaction).toBe(true)
      observe()
      expect(rows()).toEqual(before)
      if (fail) {
        throw new Error('disk failure')
      }
      return result
    })
  )
}
function cancelled(record: TaskExecutionRecord) {
  const recordedAt = new Date(TASK_TEST_NOW).toISOString()
  return {
    ...taskExecutionIdentity(record.command),
    commandFingerprint: record.commandFingerprint,
    recordedAt,
    kind: 'execution.result' as const,
    status: 'cancelled' as const,
    receiptId: 'result:cancelled',
    outcomeRef: 'outcome:cancelled',
    artifactRefs: [],
    usageFactRefs: [],
    stopProof: {
      proofRef: 'proof:cancelled',
      evidenceKind: 'not_started' as const,
      managedToolsSettled: true as const,
      writersFenced: true as const,
      recordedAt
    }
  }
}

describe('persistent task recovery evidence', () => {
  it('refreshes active executions committed by another store before scanning', async () => {
    const writerDatabase = JournalHostDatabase.openWith(directory, NO_LEGACY_JOURNAL_RECORDS)
    externalConnections.push(writerDatabase)
    const writer = AgentSessionRecordStore.open({
      journalDatabase: writerDatabase,
      hostId: store.hostId
    })
    expect(writer).not.toBe(store)
    await writer.tasks.admit({
      command: command(),
      ...TASK_TEST_CALLER,
      workspace: taskWorkspace(directory),
      now: TASK_TEST_NOW,
      validate: () => undefined
    })
    expect(store.tasks.listActive()).toEqual([])
    const active = await store.tasks.readActive(() => undefined)
    expect(active).toHaveLength(1)
    active[0].events.length = 0
    expect(store.tasks.get(command())?.events).toHaveLength(1)
  })
  it('validates a scan after queued writes finish and refuses a revoked reader', async () => {
    let revoked = false
    const validate = vi.fn(() => {
      if (revoked) {
        throw new Error('FORBIDDEN')
      }
    })
    const write = observeSqlWrite(() => {
      expect(validate).not.toHaveBeenCalled()
      expect(store.tasks.listActive()).toEqual([])
    })
    const admission = admit()
    const scan = store.tasks.readActive(validate)
    const denied = scan.then(
      () => null,
      (error: unknown) => error
    )
    expect(validate).not.toHaveBeenCalled()
    revoked = true
    await admission
    expect(await denied).toEqual(new Error('FORBIDDEN'))
    expect(write).toHaveBeenCalledOnce()
    expect(validate).toHaveBeenCalledOnce()
    expect(store.tasks.listActive()).toHaveLength(1)
  })
  it('enumerates retained active records after reopening without exposing mutable state', async () => {
    await dispatched()
    closeTestJournalHostDatabase(directory)
    const reopened = await openTestAgentSessionRecordStore(directory)
    expect(reopened).not.toBe(store)
    const active = reopened.tasks.listActive()
    expect(active).toHaveLength(1)
    expect(active[0].status).toBe('outcome_unknown')
    active[0].workspace.executionPath = 'changed'
    active[0].events.length = 0
    expect(reopened.tasks.get(command())).toEqual(store.tasks.get(command()))
  })
  it('keeps an uncommitted admission out of startup enumeration', async () => {
    const write = observeSqlWrite(() => {
      expect(store.tasks.listActive()).toEqual([])
    })
    const pending = admit()
    expect(store.tasks.listActive()).toEqual([])
    await pending
    expect(write).toHaveBeenCalledOnce()
    expect(store.tasks.listActive()).toHaveLength(1)
  })
  it('retains cancellation in enumeration until its terminal commit completes', async () => {
    const { record } = await admit()
    await store.tasks.requestCancellation(command(), 'cancel:test', TASK_TEST_NOW, () => undefined)
    const write = observeSqlWrite(() => {
      expect(store.tasks.listActive()[0].status).toBe('cancel_requested')
    })
    const pending = store.tasks.settle(command(), cancelled(record), TASK_TEST_NOW)
    expect(store.tasks.listActive()[0].status).toBe('cancel_requested')
    await pending
    expect(write).toHaveBeenCalledOnce()
    expect(store.tasks.listActive()).toEqual([])
    closeTestJournalHostDatabase(directory)
    expect((await openTestAgentSessionRecordStore(directory)).tasks.listActive()).toEqual([])
  })
  it('adopts the exact durable launch answer after response loss without calling a launcher', async () => {
    await dispatched()
    await operation(succeeded())
    closeTestJournalHostDatabase(directory)
    store = await openTestAgentSessionRecordStore(directory)
    const recovered = await recover()
    expect(recovered.changed).toBe(true)
    expect(recovered.record.launch).toEqual(TASK_TEST_LAUNCH)
    expect(recovered.record.status).toBe('running')
    expect((await recover()).changed).toBe(false)
    expect((await openTestAgentSessionRecordStore(directory)).tasks.get(command())).toEqual(
      recovered.record
    )
  })
  it('preserves a committed cancellation while adopting its launch receipt', async () => {
    await dispatched()
    await operation(succeeded())
    await store.tasks.requestCancellation(
      command(),
      'cancel:retained',
      TASK_TEST_NOW,
      () => undefined
    )
    const recovered = await recover()
    expect(recovered.record.status).toBe('cancel_requested')
    expect(recovered.record.cancellationKey).toBe('cancel:retained')
    expect(recovered.record.result).toBeNull()
  })
  it.each<AgentSessionOperationOutcome>([
    { status: 'pending' },
    { status: 'unknown' },
    { status: 'failed', code: 'launch_failed' },
    { status: 'succeeded', sessionId: 'missing-receipt' }
  ])('keeps $status evidence unresolved and retains the task slot', async (outcome) => {
    await dispatched()
    await operation(outcome)
    expect((await recover()).changed).toBe(false)
    expect(store.tasks.get(command())?.status).toBe('outcome_unknown')
    const next = {
      ...command(),
      executionId: 'execution:next',
      operationId: `${TASK_TEST_NOW}-${'c'.repeat(32)}`,
      idempotencyKey: 'key:next',
      workspaceExecutionClaimRef: 'claim:next',
      task: { ...command().task, runId: 'run:next' }
    }
    await expect(
      store.tasks.admit({
        command: next,
        ...TASK_TEST_CALLER,
        workspace: taskWorkspace(directory),
        now: TASK_TEST_NOW,
        validate: () => undefined
      })
    ).rejects.toThrow('TASK_BUSY')
  })
  it('does not bind a row belonging to another caller or operation', async () => {
    await dispatched()
    await operation(succeeded(), 'caller:other')
    await operation(
      succeeded(),
      TASK_TEST_CALLER.operationCallerKey,
      `${TASK_TEST_NOW}-${'b'.repeat(32)}`
    )
    expect((await recover()).changed).toBe(false)
    expect(store.tasks.get(command())?.launch).toBeNull()
  })
  it('rejects a changed launch fingerprint without modifying the retained record', async () => {
    await dispatched()
    await operation(succeeded())
    const before = store.tasks.get(command())
    await expect(
      store.tasks.recoverLaunch(
        store.tasks.get(command())!,
        'changed-launch',
        TASK_TEST_NOW,
        () => undefined
      )
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(store.tasks.get(command())).toEqual(before)
  })
  it('rejects a valid answer for a different workspace', async () => {
    await dispatched()
    await operation({
      status: 'succeeded',
      sessionId: '',
      launch: { ...TASK_TEST_LAUNCH, worktreeId: 'other-workspace' }
    })
    await expect(recover()).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(store.tasks.get(command())?.launch).toBeNull()
  })
  it('revalidates the current host under the same commit lock', async () => {
    await dispatched()
    await operation(succeeded())
    await expect(
      store.tasks.recoverLaunch(store.tasks.get(command())!, fingerprint, TASK_TEST_NOW, () => {
        throw new Error('host closed')
      })
    ).rejects.toThrow('host closed')
    expect(store.tasks.get(command())?.launch).toBeNull()
  })
  it('does not adopt an operation answer whose durable write failed', async () => {
    await dispatched()
    await operation({ status: 'unknown' })
    const write = observeSqlWrite(() => {
      expect(
        store.getOperationRow(TASK_TEST_CALLER.operationCallerKey, command().operationId)?.outcome
      ).toEqual({ status: 'unknown' })
      expect(store.tasks.get(command())?.launch).toBeNull()
    }, true)
    const pending = store.recordOperationOutcome({
      callerKey: TASK_TEST_CALLER.operationCallerKey,
      operationId: command().operationId,
      outcome: succeeded()
    })
    const rejected = expect(pending).rejects.toThrow('disk failure')
    const recovery = recover()
    await rejected
    expect(write).toHaveBeenCalledOnce()
    expect((await recovery).changed).toBe(false)
    expect(store.tasks.get(command())?.launch).toBeNull()
    closeTestJournalHostDatabase(directory)
    const cold = await openTestAgentSessionRecordStore(directory)
    expect(cold).not.toBe(store)
    expect(cold.tasks.get(command())?.launch).toBeNull()
    expect(
      cold.getOperationRow(TASK_TEST_CALLER.operationCallerKey, command().operationId)?.outcome
    ).toEqual({ status: 'unknown' })
  })
  it('reconciles a reopened original execution through the host without starting another agent', async () => {
    await dispatched()
    await operation(succeeded())
    closeTestJournalHostDatabase(directory)
    store = await openTestAgentSessionRecordStore(directory)
    const launch = vi.fn(async () => TASK_TEST_LAUNCH)
    const collect = vi.fn(async () => null)
    const host = new TaskExecutionHost({
      store: store.tasks,
      capabilities: () => taskCapabilities(command()),
      authorize: vi.fn(),
      launch,
      collect,
      stop: vi.fn(),
      now: () => TASK_TEST_NOW
    })
    await host.recoverPersistedExecution(
      store.tasks.get(command())!,
      TASK_TEST_CALLER,
      fingerprint,
      () => undefined
    )
    expect(store.tasks.get(command())?.status).toBe('running')
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ launch: TASK_TEST_LAUNCH }))
    expect(launch).not.toHaveBeenCalled()
  })
  it('adopts the old receipt before stopping a revoked execution and keeps cancellation proof separate', async () => {
    await dispatched()
    await operation(succeeded())
    const launch = vi.fn(async () => TASK_TEST_LAUNCH)
    const stop = vi.fn(async () => null)
    const collect = vi.fn(async () => null)
    const host = new TaskExecutionHost({
      store: store.tasks,
      capabilities: () => taskCapabilities(command()),
      authorize: vi.fn(),
      launch,
      collect,
      stop,
      now: () => TASK_TEST_NOW
    })
    const current = store.tasks.get(command())!
    await host.recoverPersistedExecution(current, TASK_TEST_CALLER, fingerprint, () => {
      throw new Error('revoked')
    })
    expect(stop).toHaveBeenCalledWith(
      expect.objectContaining({ launch: TASK_TEST_LAUNCH, cancellationKey: expect.any(String) })
    )
    expect(collect).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    expect(store.tasks.get(command())?.status).toBe('outcome_unknown')
    expect(store.tasks.get(command())?.result).toBeNull()
    expect(store.tasks.listActive()).toHaveLength(1)
  })
  it('rechecks revoked authority after result I/O and prevents a late success commit', async () => {
    await dispatched()
    await operation(succeeded())
    let revoked = false
    const launch = vi.fn(async () => TASK_TEST_LAUNCH)
    const collect = vi.fn(async () => {
      revoked = true
      return { outcomeRef: 'outcome:ready', artifactRefs: ['artifact:ready'] }
    })
    const stop = vi.fn(async (record: TaskExecutionRecord) => taskStopEvidence(record))
    const host = new TaskExecutionHost({
      store: store.tasks,
      capabilities: () => taskCapabilities(command()),
      authorize: vi.fn(),
      launch,
      collect,
      stop,
      now: () => TASK_TEST_NOW
    })
    const assertAuthorized = () => {
      if (revoked) {
        throw new Error('revoked')
      }
    }
    await expect(
      host.recoverPersistedExecution(
        store.tasks.get(command())!,
        TASK_TEST_CALLER,
        fingerprint,
        assertAuthorized
      )
    ).rejects.toThrow('revoked')
    expect(store.tasks.get(command())?.result).toBeNull()
    expect(stop).not.toHaveBeenCalled()
    await host.recoverPersistedExecution(
      store.tasks.get(command())!,
      TASK_TEST_CALLER,
      fingerprint,
      assertAuthorized
    )
    expect(store.tasks.get(command())?.result?.status).toBe('cancelled')
    expect(launch).not.toHaveBeenCalled()
  })
})
