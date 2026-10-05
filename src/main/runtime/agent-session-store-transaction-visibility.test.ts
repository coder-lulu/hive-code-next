import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as durableWrite from '../durable-file-write'
import { hiveAgentSessionEntrySchema } from '../../shared/hive-agent-session-entry'
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
  let release!: () => void
  let entered!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const paused = new Promise<void>((resolve) => {
    entered = resolve
  })
  const original = durableWrite.writeTempFileDurable
  const write = vi
    .spyOn(durableWrite, 'writeTempFileDurable')
    .mockImplementationOnce(async (...args) => {
      entered()
      await held
      if (outcome === 'rollback') {
        throw new Error('held-write-failed')
      }
      await original(...args)
    })
  const result = action().then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error })
  )
  try {
    await Promise.race([
      paused,
      result.then(() => {
        throw new Error('write was never held')
      })
    ])
    observe()
    expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
    release()
    expect((await result).ok).toBe(outcome === 'commit')
    if (outcome === 'rollback') {
      expect(await readPersistedTestAgentSessionStoreText(directory)).toBe(before)
    }
  } finally {
    release()
    await result
    write.mockRestore()
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
