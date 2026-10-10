import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_STRUCTURED_AGENTS } from '../native-chat/agent-session-wire/structured-agent-session-adapter-router-test-support'
import { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { recordingStructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger-test-support'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { dockerSessionFixture, dockerOwnerRunner } from './task-docker-session-owner.test-fixture'
import { createTaskDockerSessionOwner } from './task-docker-session-owner'
import { createTaskCodexEvidence } from './task-codex-evidence'
import { collectTaskExecutionSettlement } from './task-execution-settlement'
import { taskCancelledResult } from './task-cancelled-result'
import { TASK_TEST_NOW } from './task-execution.test-fixture'

afterEach(() => setStructuredAgentSessionHost(null))

async function fixture(options: { cancelled?: boolean; reopened?: boolean } = {}) {
  const f = await dockerSessionFixture(
    true,
    true,
    resolve('logs/tests/task-codex-bound-cancellation/tmp')
  )
  const original = f.store.tasks.get(f.command)!
  const sessionId = original.structuredBinding!.sessionId
  await f.store.tasks.bindLaunch(
    original,
    {
      worktreeId: f.task.workspace.workspaceId,
      outcome: { kind: 'structured', sessionId, handle: 'original-bound-task' },
      receipt: {
        mode: 'structured',
        preferred: 'structured',
        reason: 'user_default',
        detail: 'Original isolated test execution.'
      }
    },
    TASK_TEST_NOW
  )
  await f.store.transitionHandoff(sessionId, (record) => ({
    ...record,
    lease: { ...record.lease, handoffStage: 'recovering' }
  }))
  if (options.cancelled !== false) {
    await f.store.tasks.requestCancellation(f.command, 'cancel:original', TASK_TEST_NOW, f.validate)
  }
  await f.store.tasks.markUnknown(f.command, TASK_TEST_NOW)
  if (options.reopened) {
    closeTestJournalHostDatabase(f.directory)
  }
  const store = options.reopened ? await openTestAgentSessionRecordStore(f.directory) : f.store
  const runner = dockerOwnerRunner(f)
  runner.exit()
  const owner = createTaskDockerSessionOwner({ store, run: runner.run })
  const acquire = vi.fn(async () => {
    throw new Error('Cancellation cannot start a provider')
  })
  const dispatch = vi.fn(async () => ({ state: 'unknown' as const, reason: 'not dispatched' }))
  const releaseAcquisition = vi.fn(async () => true)
  const stop = vi.fn(owner.stop)
  const host = new StructuredAgentSessionHost({
    agents: NO_STRUCTURED_AGENTS,
    logger: recordingStructuredAgentSessionLogger().logger,
    store,
    adapter: {
      acquire,
      dispatch,
      cancelTurn: vi.fn(async () => ({ cancelled: false })),
      answerPrompt: vi.fn(async () => undefined),
      setOption: vi.fn(async () => undefined),
      releaseAcquisition
    },
    journalDatabase: openTestJournalHostDatabase(f.directory),
    claimKeyId: 'claim-key-one',
    now: () => TASK_TEST_NOW + 1000,
    stopExecutionOwner: stop,
    probeOwner: async (record) =>
      (await owner.probe(record)) ?? { outcome: 'execution-host-unverifiable' }
  })
  setStructuredAgentSessionHost(host)
  if (options.reopened) {
    expect(store).not.toBe(f.store)
    expect(store.getRecord(sessionId)?.lease.unreconciled).toBe(true)
    await host.reconcileRestartLeases()
  }
  const evidence = createTaskCodexEvidence(resolve(f.directory, 'artifacts'))
  const settle = () =>
    collectTaskExecutionSettlement(
      {
        store: store.tasks,
        collect: evidence.collect,
        stop: evidence.stop,
        capabilities: () => null,
        authorize: async () => {
          throw new Error('Cancellation cannot authorize new work')
        },
        launch: acquire
      },
      store.tasks.get(f.command)!,
      undefined,
      () => TASK_TEST_NOW + 1000
    )
  return {
    ...f,
    store,
    sessionId,
    host,
    runner,
    acquire,
    dispatch,
    releaseAcquisition,
    stop,
    evidence,
    settle
  }
}

describe('cancel an original bound Task after its provider exited', () => {
  it.each([false, true])('settles only after exact host death (reopened=%s)', async (reopened) => {
    const f = await fixture({ reopened })
    await f.settle()
    expect(f.store.tasks.get(f.command)).toMatchObject({
      status: 'cancelled',
      result: { status: 'cancelled', stopProof: { evidenceKind: 'stopped' } }
    })
    expect(f.stop).toHaveBeenCalledTimes(reopened ? 0 : 1)
    expect(f.releaseAcquisition).toHaveBeenCalledOnce()
    expect(f.store.getRecord(f.sessionId)?.lease).toMatchObject({
      claimStatus: 'released',
      deathEvidence: { kind: 'execution-host-exit-observed', ownerFence: 1 }
    })
    expect(f.host.hasSession(f.sessionId)).toBe(false)
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
  })

  it('does not recover an unknown bound Task without cancellation authority', async () => {
    const f = await fixture({ cancelled: false })
    expect(await f.evidence.stop(f.store.tasks.get(f.command)!)).toBeNull()
    expect(f.stop).not.toHaveBeenCalled()
    expect(f.store.getRecord(f.sessionId)?.lease.deathEvidence).toBeNull()
    expect(f.store.tasks.get(f.command)?.result).toBeNull()
  })

  it.each(['missing', 'mismatch', 'live'] as const)(
    'retains occupancy when host is %s',
    async (kind) => {
      const f = await fixture()
      if (kind === 'missing') {
        f.runner.missing()
      }
      if (kind === 'mismatch') {
        f.runner.daemon.ID = 'another-daemon'
      }
      if (kind === 'live') {
        f.runner.container.State.Status = 'running'
        f.runner.container.State.Running = true
        f.runner.container.State.Pid = 231
        f.runner.keepLive()
      }
      await f.settle()
      expect(f.store.tasks.get(f.command)).toMatchObject({
        status: 'outcome_unknown',
        result: null
      })
      expect(f.store.getRecord(f.sessionId)?.lease.deathEvidence).toBeNull()
      expect(f.acquire).not.toHaveBeenCalled()
      expect(f.dispatch).not.toHaveBeenCalled()
    }
  )

  it('rejects a forged cancelled receipt before the host death is committed', async () => {
    const f = await fixture()
    const stopping = f.store.tasks.get(f.command)!
    await expect(
      f.store.tasks.settle(
        f.command,
        taskCancelledResult(stopping, 'stopped', TASK_TEST_NOW + 1000),
        TASK_TEST_NOW + 1000,
        stopping
      )
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.store.tasks.get(f.command)?.result).toBeNull()
  })

  it('requires the captured stopping snapshot even after exact death was observed', async () => {
    const f = await fixture()
    const stopping = f.store.tasks.get(f.command)!
    expect(await f.evidence.stop(stopping)).toMatchObject({ evidenceKind: 'stopped' })
    await expect(
      f.store.tasks.settle(
        f.command,
        taskCancelledResult(stopping, 'stopped', TASK_TEST_NOW + 1000),
        TASK_TEST_NOW + 1000
      )
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.store.tasks.get(f.command)?.result).toBeNull()
  })

  it('reuses only exact durable death for repeated close without a new owner stop', async () => {
    const f = await fixture({ reopened: true })
    const stopping = f.store.tasks.get(f.command)!
    const first = await f.evidence.stop(stopping)
    expect(first).toMatchObject({ evidenceKind: 'stopped' })
    expect(await f.evidence.stop(stopping)).toEqual(first)
    expect(f.releaseAcquisition).toHaveBeenCalledTimes(2)
    expect(f.stop).not.toHaveBeenCalled()
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
  })

  it.each(['missing', 'foreign'] as const)(
    'rejects released ownership with %s death proof',
    async (kind) => {
      const f = await fixture({ reopened: true })
      await f.store.transitionHandoff(f.sessionId, (record) => {
        const death = record.lease.deathEvidence
        if (death?.kind !== 'execution-host-exit-observed') {
          throw new Error('The startup fixture must observe exact execution death')
        }
        return {
          ...record,
          lease: {
            ...record.lease,
            deathEvidence:
              kind === 'missing'
                ? null
                : {
                    ...death,
                    witness: { ...death.witness, containerId: 'c'.repeat(64) }
                  }
          }
        }
      })
      expect(await f.evidence.stop(f.store.tasks.get(f.command)!)).toBeNull()
      expect(f.store.tasks.get(f.command)?.result).toBeNull()
      expect(f.releaseAcquisition).not.toHaveBeenCalled()
      expect(f.stop).not.toHaveBeenCalled()
    }
  )
})
