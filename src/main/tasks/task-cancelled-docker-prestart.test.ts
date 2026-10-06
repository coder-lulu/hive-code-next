import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  agentSessionOperationKey,
  isAgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'
import { TaskExecutionRecordSchema } from './task-execution-record'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import * as durableWrite from '../durable-file-write'
import {
  openTestAgentSessionRecordStore,
  editPersistedTestAgentSessionStore,
  readPersistedTestAgentSessionStore,
  readPersistedTestAgentSessionStoreText,
  testAgentSessionStoreFilePath
} from '../runtime/agent-session-record-store-test-harness'
import {
  taskCancelledDockerPrestartFixture as fixture,
  settleTaskCancelledDockerPrestart as settle,
  refreshTaskCancelledDockerPrestart as refresh,
  assertTaskCancelledDockerPrestartUnsettled as unsettled
} from './task-cancelled-docker-prestart.test-fixture'

describe('original durable cancelled Docker prestart settlement', () => {
  it.each([false, true])(
    'persists only the original cancelled/not_started result (captured CID=%s)',
    async (cid) => {
      const f = await fixture(true, cid)
      const before = await readPersistedTestAgentSessionStore(f.directory)
      await settle(f)
      const record = f.store.tasks.get(f.command)!
      expect(record.result).toMatchObject({
        status: 'cancelled',
        commandFingerprint: f.expected.commandFingerprint,
        artifactRefs: [],
        usageFactRefs: [],
        stopProof: { evidenceKind: 'not_started', managedToolsSettled: true, writersFenced: true }
      })
      expect(record.dispatch).toBe('dispatching')
      expect(record.launch).toBeNull()
      expect(record.dockerIdentity).toEqual(f.expected.dockerIdentity)
      const persisted = await readPersistedTestAgentSessionStore(f.directory)
      expect(persisted.records).toEqual(before.records)
      expect(persisted.operations).toEqual(before.operations)
      const reopened = await openTestAgentSessionRecordStore(f.directory)
      expect(reopened.tasks.get(f.command)?.result).toEqual(record.result)
      expect(reopened.getRecord(f.session.sessionId)?.lease).toMatchObject({
        claimStatus: 'reserved',
        runtimeFence: f.session.lease.runtimeFence,
        deathEvidence: null
      })
      await settle(f)
      expect(f.store.tasks.get(f.command)?.result).toEqual(record.result)
    }
  )
  it('does not turn an uncancelled reservation into a terminal result', async () => {
    const f = await fixture(false)
    const before = await readPersistedTestAgentSessionStoreText(f.directory)
    await settle(f)
    await unsettled(f)
    expect(await readPersistedTestAgentSessionStoreText(f.directory)).toBe(before)
  })
  it.each(['owner', 'handle', 'model'])('rejects an observed %s effect', async (effect) => {
    const f = await fixture()
    if (effect === 'model') {
      await editPersistedTestAgentSessionStore(f.directory, (p) => {
        p.taskExecutions[f.key] = TaskExecutionRecordSchema.parse({
          ...p.taskExecutions[f.key],
          modelDispatchAttempts: 1
        })
      })
    } else {
      await f.store.commitProcessIdentity({
        sessionId: f.session.sessionId,
        fence: f.session.lease.runtimeFence,
        process: {
          hostId: 'local',
          pid: 4242,
          processStartTimeMs: TASK_TEST_NOW,
          spawnToken: f.session.lease.reservedSpawnToken!
        },
        now: TASK_TEST_NOW
      })
      if (effect === 'handle') {
        await f.store.proveOwner({
          sessionId: f.session.sessionId,
          fence: f.session.lease.runtimeFence,
          now: TASK_TEST_NOW,
          link: {
            linkId: 'synthetic-link',
            handle: { provider: 'codex', threadId: 'synthetic-thread' },
            origin: 'created',
            mintedAtFence: f.session.lease.runtimeFence,
            observedAt: TASK_TEST_NOW
          }
        })
      }
    }
    await refresh(f)
    await settle(f)
    await unsettled(f)
  })
  it('rechecks the exact Session snapshot after a real original-store write', async () => {
    const f = await fixture()
    await f.store.setConversationName(f.session.sessionId, 'Changed after observation')
    await settle(f)
    await unsettled(f)
  })
  it('rechecks the authorized immutable Task after a valid external workspace change', async () => {
    const f = await fixture()
    await editPersistedTestAgentSessionStore(f.directory, (p) => {
      const task = p.taskExecutions[f.key]!
      p.taskExecutions[f.key] = TaskExecutionRecordSchema.parse({
        ...task,
        workspace: { ...task.workspace, canonicalPath: join(f.directory, 'replacement') }
      })
    })
    await expect(settle(f)).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    await unsettled(f)
  })
  it.each([
    'parent-pending',
    'parent-succeeded',
    'child-pending',
    'child-unknown',
    'parent-fingerprint',
    'child-fingerprint',
    'parent-expired',
    'child-expired'
  ])('rejects original ledger %s facts under the file lock', async (kind) => {
    const f = await fixture()
    await editPersistedTestAgentSessionStore(f.directory, (p) => {
      const id = kind.startsWith('parent') ? f.outer.operationId : f.request.operation.operationId
      const row = p.operations[agentSessionOperationKey(f.outer.callerKey, id)]!
      if (kind.endsWith('pending')) {
        row.outcome = { status: 'pending' }
      }
      if (kind.endsWith('succeeded')) {
        row.outcome = { status: 'succeeded', sessionId: f.session.sessionId }
      }
      if (kind.endsWith('unknown')) {
        row.outcome = { status: 'unknown' }
      }
      if (kind.endsWith('fingerprint')) {
        row.fingerprint = 'synthetic:wrong-fingerprint'
      }
      if (kind.endsWith('expired')) {
        row.expiresAt = TASK_TEST_NOW
      }
      expect(isAgentSessionOperationRow(row)).toBe(true)
    })
    await refresh(f)
    await settle(f)
    await unsettled(f)
  })
  it.each(['stale', 'future', 'wrong-cid', 'malformed-cid'])(
    'rejects %s proof facts',
    async (kind) => {
      const f = await fixture(true, true)
      const evidence = { ...f.evidence }
      if (kind === 'stale') {
        evidence.observedAt -= 10_001
      }
      if (kind === 'future') {
        evidence.observedAt += 1
      }
      if (kind === 'wrong-cid') {
        evidence.containerId = 'd'.repeat(64)
      }
      if (kind === 'malformed-cid') {
        evidence.containerId = 'not-a-cid'
      }
      await settle(f, evidence)
      await unsettled(f)
    }
  )
  it.each(['quarantine', 'unreadable'])('retains %s store denial across reopen', async (kind) => {
    const f = await fixture()
    const p = await readPersistedTestAgentSessionStore(f.directory)
    if (kind === 'unreadable') {
      p.unusableRecords['synthetic-unreadable'] = { reason: 'malformed', raw: {} }
    }
    await writeFile(
      testAgentSessionStoreFilePath(f.directory),
      JSON.stringify({
        ...p,
        ...(kind === 'quarantine' ? { taskRecoveryBlocked: true } : {})
      })
    )
    await refresh(f)
    await settle(f)
    await unsettled(f)
  })
  it('revalidates current authority inside the original transaction', async () => {
    const f = await fixture()
    await expect(
      settle(f, f.evidence, TASK_TEST_NOW, () => {
        throw new Error('FORBIDDEN')
      })
    ).rejects.toThrow('FORBIDDEN')
    await unsettled(f)
  })
  it('rolls back a failed durable receipt write and commits only on a later successful retry', async () => {
    const f = await fixture()
    const before = await readPersistedTestAgentSessionStoreText(f.directory)
    vi.spyOn(durableWrite, 'writeTempFileDurable').mockRejectedValueOnce(
      new Error('synthetic-write-failed')
    )
    await expect(settle(f)).rejects.toThrow('synthetic-write-failed')
    await unsettled(f)
    expect(await readPersistedTestAgentSessionStoreText(f.directory)).toBe(before)
    await settle(f)
    expect(
      (await openTestAgentSessionRecordStore(f.directory)).tasks.get(f.command)?.result?.status
    ).toBe('cancelled')
  })
})
