import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  readPersistedTestAgentSessionStoreText
} from '../runtime/agent-session-record-store-test-harness'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import {
  taskStructuredFixture,
  TASK_STRUCTURED_LOGS
} from './task-structured-reservation.test-fixture'
import { taskWorkspace, TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskExecutionRecordKey } from './task-execution-record'
import { agentSessionOperationKey } from '../../shared/agent-session-operation-ledger'

let directory: string
let store: AgentSessionRecordStore
beforeEach(async () => {
  const root = resolve(TASK_STRUCTURED_LOGS, 'tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'reservation-'))
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
    callerKey: fixture.origin.operationCallerKey,
    operationId: fixture.origin.operationId,
    fingerprint: fixture.origin.launchFingerprint,
    now: TASK_TEST_NOW
  })
  expect(
    (
      await store.claimOperation({
        callerKey: fixture.origin.operationCallerKey,
        operationId: fixture.origin.operationId
      })
    ).claim
  ).toBe('won')
  return fixture
}

describe('task binding in the original durable transaction', () => {
  it.each(['initial', 'replay', 'acquire'] as const)(
    'rejects a Promise-returning original guard during %s without changing durable state',
    async (phase) => {
      const { command, request, origin } = await admitted()
      const reserved = phase === 'initial' ? null : await store.reserveOwner(request)
      const before = await readPersistedTestAgentSessionStoreText(directory)
      const taskBefore = store.tasks.get(command)
      const denial = Promise.reject(new Error('async-authorization-denied'))
      void denial.catch(() => undefined)
      request.taskOrigin = { ...origin, validate: () => denial }
      const attempt =
        phase === 'acquire' && reserved
          ? store.assertTaskAcquisition(request, reserved.record)
          : store.reserveOwner(request)
      await expect(attempt).rejects.toThrow()
      expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
      expect(store.tasks.get(command)).toEqual(taskBefore)
      if (!reserved) {
        expect(store.getRecord(request.sessionId)).toBeNull()
        expect(
          store.getOperationRow(request.operation.callerKey, request.operation.operationId)
        ).toBeNull()
      }
    }
  )
  it('commits task source, reservation and inner operation together and cold reads them', async () => {
    const { command, request, origin } = await admitted()
    const reserved = await store.reserveOwner(request)
    const persisted = await readPersistedTestAgentSessionStore(directory)
    const task = persisted.taskExecutions[taskExecutionRecordKey(command)]
    expect(task.structuredBinding).toMatchObject({
      source: origin.source,
      sessionId: request.sessionId,
      runtimeFence: reserved.record.lease.runtimeFence,
      spawnToken: reserved.record.lease.reservedSpawnToken
    })
    expect(task.revision).toBe(3)
    expect(task.events).toHaveLength(1)
    expect(persisted.records[request.sessionId].taskSource).toEqual(origin.source)
    expect(
      persisted.operations[
        agentSessionOperationKey(request.operation.callerKey, request.operation.operationId)
      ].outcome.status
    ).toBe('pending')
    await expect(store.assertTaskAcquisition(request, reserved.record)).resolves.toBeUndefined()
    closeTestJournalHostDatabase(directory)
    const reopened = await openTestAgentSessionRecordStore(directory)
    expect(reopened.tasks.get(command)).toEqual(task)
    expect(reopened.getRecord(request.sessionId)?.taskSource).toEqual(origin.source)
    expect(reopened.getRecord(request.sessionId)?.lease.unreconciled).toBe(true)
  })
  it('replays the exact binding without changing the task revision or persisted answer', async () => {
    const { command, request } = await admitted()
    const first = await store.reserveOwner(request)
    const task = store.tasks.get(command)
    const before = await readPersistedTestAgentSessionStoreText(directory)
    const next = await store.reserveOwner(request)
    expect(next.disposition).toBe('replayed')
    expect(next.record).toEqual(first.record)
    expect(store.tasks.get(command)).toEqual(task)
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
  })
  it('rolls back all three bindings when the original atomic write fails', async () => {
    const { command, request } = await admitted()
    const before = await readPersistedTestAgentSessionStoreText(directory)
    const database = openTestJournalHostDatabase(directory)
    const original = database.transaction.bind(database)
    vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
      original((db) => {
        run(db)
        throw new Error('reservation-write-failed')
      })
    )
    await expect(store.reserveOwner(request)).rejects.toThrow('reservation-write-failed')
    expect(store.tasks.get(command)?.structuredBinding).toBeUndefined()
    expect(store.tasks.get(command)?.revision).toBe(2)
    expect(store.getRecord(request.sessionId)).toBeNull()
    expect(
      store.getOperationRow(request.operation.callerKey, request.operation.operationId)
    ).toBeNull()
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
  })
  it('rechecks the current grant on acquisition and leaves all durable state unchanged on refusal', async () => {
    const { request, validate } = await admitted()
    const reserved = await store.reserveOwner(request)
    const before = await readPersistedTestAgentSessionStoreText(directory)
    validate.mockImplementation(() => {
      throw new Error('authorization-revoked')
    })
    await expect(store.assertTaskAcquisition(request, reserved.record)).rejects.toThrow(
      'authorization-revoked'
    )
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
  })
  it('refreshes task cancellation written by another store before acquisition', async () => {
    const other = await openTestAgentSessionRecordStore(directory)
    const { command, request, validate } = await admitted()
    const reserved = await store.reserveOwner(request)
    await other.tasks.requestCancellation(command, 'cancel:other-store', TASK_TEST_NOW, validate)
    const before = await readPersistedTestAgentSessionStoreText(directory)
    await expect(store.assertTaskAcquisition(request, reserved.record)).rejects.toThrow(
      'agent_session_ownership_unknown'
    )
    expect(store.tasks.get(command)?.cancellationKey).toBe('cancel:other-store')
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
  })
  it('refuses stripped origin and stripped source without creating a personal owner', async () => {
    const { request } = await admitted()
    const reserved = await store.reserveOwner(request)
    delete request.taskOrigin
    const stripped = { ...reserved.record }
    delete stripped.taskSource
    const before = await readPersistedTestAgentSessionStoreText(directory)
    await expect(store.reserveOwner(request)).rejects.toThrow('agent_session_operation_invalid')
    await expect(store.assertTaskAcquisition(request, stripped)).rejects.toThrow(
      'agent_session_operation_invalid'
    )
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
  })
})
