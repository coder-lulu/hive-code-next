import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentSessionLeaseAdmitsWriter } from '../../shared/agent-session-lease-adjudication'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { resolveStructuredSessionRecovery } from '../native-chat/agent-session-wire/structured-agent-session-recovery-resolution'
import {
  openTestAgentSessionRecordStore,
  editPersistedTestAgentSessionStore,
  readPersistedTestAgentSessionStoreText
} from '../runtime/agent-session-record-store-test-harness'
import { createTaskDockerSessionOwner } from './task-docker-session-owner'
import { taskExecutionRecordKey } from './task-execution-record'
import {
  dockerSessionFixture,
  dockerOwnerRunner,
  executionWitness
} from './task-docker-session-owner.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'

afterEach(() => vi.restoreAllMocks())

describe('Task CID recovery in original session transactions', () => {
  it.each([true, false])('cold live CID preserves unreconciled for CLI owner=%s', async (live) => {
    const fixture = await dockerSessionFixture(live)
    const runner = dockerOwnerRunner(fixture)
    closeTestJournalHostDatabase(fixture.directory)
    const cold = await openTestAgentSessionRecordStore(fixture.directory)
    const owner = createTaskDockerSessionOwner({ store: cold, run: runner.run })
    await cold.reconcileOnRestart({
      probe: async (record) => (await owner.probe(record)) ?? { outcome: 'reservation-unused' },
      now: TASK_TEST_NOW + 1000
    })
    expect(cold.getRecord(fixture.record().sessionId)?.lease).toMatchObject({
      runtimeFence: 1,
      handoffStage: 'recovering',
      unreconciled: true,
      deathEvidence: null
    })
    const record = cold.getRecord(fixture.record().sessionId)
    if (!record) {
      throw new Error('fixture missing')
    }
    expect(agentSessionLeaseAdmitsWriter(record.lease)).toBe(false)
    const again = await openTestAgentSessionRecordStore(fixture.directory)
    expect(again.getRecord(record.sessionId)?.lease.unreconciled).toBe(true)
  })
  it('cold unverifiable CID stays recovering without inventing processless proof', async () => {
    const fixture = await dockerSessionFixture(false, false)
    closeTestJournalHostDatabase(fixture.directory)
    const cold = await openTestAgentSessionRecordStore(fixture.directory)
    const owner = createTaskDockerSessionOwner({ store: cold, run: dockerOwnerRunner(fixture).run })
    await cold.reconcileOnRestart({
      probe: async (record) => (await owner.probe(record)) ?? { outcome: 'reservation-unused' },
      now: TASK_TEST_NOW + 1000
    })
    expect(cold.getRecord(fixture.record().sessionId)?.lease).toMatchObject({
      claimStatus: 'reserved',
      runtimeFence: 1,
      unreconciled: true,
      handoffStage: 'recovering',
      deathEvidence: null
    })
  })
  it.each([true, false])(
    'resolves %s original cold owner only after exact CID stop',
    async (live) => {
      const fixture = await dockerSessionFixture(live)
      const runner = dockerOwnerRunner(fixture)
      closeTestJournalHostDatabase(fixture.directory)
      const cold = await openTestAgentSessionRecordStore(fixture.directory)
      const owner = createTaskDockerSessionOwner({ store: cold, run: runner.run })
      const probeRecord = async (record: Parameters<typeof owner.probe>[0]) =>
        (await owner.probe(record)) ?? { outcome: 'reservation-unused' as const }
      await cold.reconcileOnRestart({ probe: probeRecord, now: TASK_TEST_NOW + 1000 })
      const stopOwnerProcess = vi.fn()
      expect(
        await resolveStructuredSessionRecovery(
          {
            store: cold,
            probeRecord,
            stopExecutionOwner: owner.stop,
            stopOwnerProcess,
            now: () => TASK_TEST_NOW + 2000
          },
          fixture.record().sessionId
        )
      ).toBe('resolved')
      expect(stopOwnerProcess).not.toHaveBeenCalled()
      const released = cold.getRecord(fixture.record().sessionId)
      expect(released?.lease).toMatchObject({
        runtimeFence: 2,
        claimStatus: 'released',
        unreconciled: false,
        handoffStage: null,
        ownerProcess: null,
        reservedSpawnToken: null,
        deathEvidence: {
          kind: 'execution-host-exit-observed',
          ownerFence: 1,
          witness: executionWitness(fixture.record())
        }
      })
      closeTestJournalHostDatabase(fixture.directory)
      const reopened = await openTestAgentSessionRecordStore(fixture.directory)
      const freshOwner = createTaskDockerSessionOwner({ store: reopened, run: runner.run })
      await reopened.reconcileOnRestart({
        probe: async (record) =>
          (await freshOwner.probe(record)) ?? { outcome: 'reservation-unused' },
        now: TASK_TEST_NOW + 3000
      })
      expect(reopened.getRecord(fixture.record().sessionId)?.lease).toMatchObject({
        runtimeFence: 2,
        unreconciled: false,
        claimStatus: 'released'
      })
    }
  )
  it('warm stop false never releases the lease, never signals the Docker CLI PID', async () => {
    const fixture = await dockerSessionFixture()
    const runner = dockerOwnerRunner(fixture)
    runner.keepLive()
    await fixture.store.transitionHandoff(fixture.record().sessionId, (record) => ({
      ...record,
      lease: { ...record.lease, handoffStage: 'recovering' }
    }))
    const before = await readPersistedTestAgentSessionStoreText(fixture.directory)
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    const stopOwnerProcess = vi.fn()
    expect(
      await resolveStructuredSessionRecovery(
        {
          store: fixture.store,
          probeRecord: async (record) =>
            (await owner.probe(record)) ?? { outcome: 'reservation-unused' },
          stopExecutionOwner: owner.stop,
          stopOwnerProcess,
          now: () => TASK_TEST_NOW + 1000
        },
        fixture.record().sessionId
      )
    ).toBe('unresolved')
    expect(stopOwnerProcess).not.toHaveBeenCalled()
    expect(await readPersistedTestAgentSessionStoreText(fixture.directory)).toBe(before)
  })
  it.each(['session', 'host', 'source', 'fence', 'token', 'cid', 'daemon', 'image'] as const)(
    'rejects a stale %s witness inside the original warm eviction transaction',
    async (field) => {
      const fixture = await dockerSessionFixture()
      const record = fixture.record()
      const witness = executionWitness(record)
      if (field === 'session') {
        witness.sessionId = 'session-other-one'
      }
      if (field === 'host') {
        Object.defineProperty(witness, 'hostId', { value: 'remote', enumerable: true })
      }
      if (field === 'source') {
        witness.source = { ...witness.source, ownershipEpoch: witness.source.ownershipEpoch + 1 }
      }
      if (field === 'fence') {
        witness.ownerFence += 1
      }
      if (field === 'token') {
        witness.spawnToken = 'other-spawn'
      }
      if (field === 'cid') {
        witness.containerId = 'c'.repeat(64)
      }
      if (field === 'daemon') {
        witness.daemonId = 'daemon:other'
      }
      if (field === 'image') {
        witness.imageId = `sha256:${'c'.repeat(64)}`
      }
      const before = await readPersistedTestAgentSessionStoreText(fixture.directory)
      await expect(
        fixture.store.evictProvenDeadOwner({
          sessionId: record.sessionId,
          expectedFence: record.lease.runtimeFence,
          probe: { outcome: 'execution-host-exited', witness },
          now: TASK_TEST_NOW + 1000
        })
      ).rejects.toThrow('agent_session_ownership_unknown')
      expect(await readPersistedTestAgentSessionStoreText(fixture.directory)).toBe(before)
    }
  )
  it.each(['token', 'fence', 'cid'] as const)(
    'rechecks changed original Task %s after probe and before commit',
    async (field) => {
      const fixture = await dockerSessionFixture()
      const record = fixture.record()
      const probe = { outcome: 'execution-host-exited' as const, witness: executionWitness(record) }
      await editPersistedTestAgentSessionStore(fixture.directory, (persisted) => {
        const task = persisted.taskExecutions[taskExecutionRecordKey(fixture.command)]
        if (!task?.structuredBinding || !task.dockerIdentity) {
          throw new Error('fixture metadata missing')
        }
        if (field === 'token') {
          task.structuredBinding.spawnToken = 'task-other-token'
        }
        if (field === 'fence') {
          task.structuredBinding.runtimeFence += 1
        }
        if (field === 'cid') {
          task.dockerIdentity.containerId = 'c'.repeat(64)
        }
      })
      const before = await readPersistedTestAgentSessionStoreText(fixture.directory)
      await expect(
        fixture.store.evictProvenDeadOwner({
          sessionId: record.sessionId,
          expectedFence: record.lease.runtimeFence,
          probe,
          now: TASK_TEST_NOW + 1000
        })
      ).rejects.toThrow(/agent_session_ownership_unknown|execution_owner_reconciling/)
      expect(await readPersistedTestAgentSessionStoreText(fixture.directory)).toBe(before)
      closeTestJournalHostDatabase(fixture.directory)
      const cold = await openTestAgentSessionRecordStore(fixture.directory)
      await cold.reconcileOnRestart({
        probe: async () => probe,
        now: TASK_TEST_NOW + 2000
      })
      expect(cold.getRecord(record.sessionId)?.lease).toMatchObject({
        runtimeFence: 1,
        unreconciled: true,
        handoffStage: 'recovering',
        deathEvidence: null
      })
    }
  )
  it('rolls back the original CID death transition when durable write fails', async () => {
    const fixture = await dockerSessionFixture()
    const record = fixture.record()
    const before = await readPersistedTestAgentSessionStoreText(fixture.directory)
    const database = openTestJournalHostDatabase(fixture.directory)
    const transaction = database.transaction.bind(database)
    vi.spyOn(database, 'transaction').mockImplementationOnce((apply) =>
      transaction((db) => {
        apply(db)
        throw new Error('owner-write-failed')
      })
    )
    await expect(
      fixture.store.evictProvenDeadOwner({
        sessionId: record.sessionId,
        expectedFence: record.lease.runtimeFence,
        probe: { outcome: 'execution-host-exited', witness: executionWitness(record) },
        now: TASK_TEST_NOW + 1000
      })
    ).rejects.toThrow('owner-write-failed')
    expect(fixture.store.getRecord(record.sessionId)).toEqual(record)
    expect(await readPersistedTestAgentSessionStoreText(fixture.directory)).toBe(before)
  })
})
