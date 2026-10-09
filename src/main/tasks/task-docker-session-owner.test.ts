import { codexProviderHandle } from '../../shared/agent-session-provider-handle-encoding'
import { mkdir, rename } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { probeAgentSessionProcessIdentities } from '../runtime/agent-session-process-identity-probe'
import {
  createStructuredAgentSessionOwnerProbe,
  createStructuredAgentSessionOwnerProbes
} from '../runtime/structured-agent-session-owner-probe'
import { createTaskDockerSessionOwner } from './task-docker-session-owner'
import {
  dockerSessionFixture,
  dockerOwnerRunner,
  executionWitness,
  OWNER_CID,
  personalSessionFixture
} from './task-docker-session-owner.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskExecutionIdentity } from './task-execution-record'
import { createTrackedJournalOpener } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session-journal-types'

const journals = createTrackedJournalOpener()
afterEach(async () => {
  await journals.closeAll()
  vi.useRealTimers()
})

describe('Task Docker owner probes from the original binding', () => {
  it('reports original CID live even when the CLI PID is absent', async () => {
    const fixture = await dockerSessionFixture()
    const runner = dockerOwnerRunner(fixture)
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    const pidProbe = vi.fn(async () => ({ outcome: 'pid-absent' as const }))
    const probe = createStructuredAgentSessionOwnerProbe('local', pidProbe, undefined, owner)
    expect(owner.classify(fixture.record())).toBe('task')
    expect(await probe(fixture.record())).toEqual({
      outcome: 'execution-host-live',
      witness: executionWitness(fixture.record())
    })
    expect(pidProbe).not.toHaveBeenCalled()
    expect(runner.run.mock.calls.filter(([spec]) => spec.args?.[4] === 'container')).toHaveLength(1)
    expect(runner.run.mock.calls.every(([spec]) => spec.env?.ORCA_BACKGROUND_LAUNCH === '1')).toBe(
      true
    )
  })
  it('routes mixed single/batch Task probes before ownerless and PID shortcuts', async () => {
    const fixture = await dockerSessionFixture(false)
    const runner = dockerOwnerRunner(fixture)
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    const pidBatch = vi.fn(
      async (_args: Parameters<typeof probeAgentSessionProcessIdentities>[0]) => [
        { outcome: 'identity-matched' as const, matchedOn: ['spawn-token' as const] }
      ]
    )
    const personal = await personalSessionFixture(fixture)
    const probes = createStructuredAgentSessionOwnerProbes('local', pidBatch, undefined, owner)
    const result = await probes([fixture.record(), personal])
    expect(result.get(fixture.record().sessionId)?.outcome).toBe('execution-host-live')
    expect(pidBatch.mock.calls[0]?.[0].identities).toEqual([personal.lease.ownerProcess])
  })
  it('keeps Task source unavailable when the runtime has no Docker owner port', async () => {
    const fixture = await dockerSessionFixture(false)
    const scan = vi.fn(async () => [])
    const probe = createStructuredAgentSessionOwnerProbe('local', undefined, scan)
    expect(await probe(fixture.record())).toEqual({ outcome: 'execution-host-unverifiable' })
    expect(scan).not.toHaveBeenCalled()
  })
  it('returns null only for the original positively personal session', async () => {
    const fixture = await dockerSessionFixture()
    const personal = await personalSessionFixture(fixture)
    const runner = dockerOwnerRunner(fixture)
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    expect(await owner.probe(personal)).toBeNull()
    expect(owner.classify(personal)).toBe('personal')
    expect(owner.classify({ ...personal, sessionId: 'session-unknown' })).toBe('unverifiable')
    expect(runner.run).not.toHaveBeenCalled()
  })
  it('never downgrades a stripped or stale Task record to a personal PID probe', async () => {
    const fixture = await dockerSessionFixture()
    const runner = dockerOwnerRunner(fixture)
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    const stripped = { ...fixture.record() }
    delete stripped.taskSource
    expect(owner.classify(stripped)).toBe('unverifiable')
    expect(await owner.probe(stripped)).toEqual({ outcome: 'execution-host-unverifiable' })
    expect(await owner.stop(stripped)).toEqual({ outcome: 'execution-host-unverifiable' })
    const stale = { ...fixture.record(), lease: { ...fixture.record().lease, runtimeFence: 9 } }
    expect(owner.classify(stale)).toBe('unverifiable')
    expect(await owner.probe(stale)).toEqual({ outcome: 'execution-host-unverifiable' })
    expect(runner.run).not.toHaveBeenCalled()
  })
  it.each(['active', 'terminal'] as const)(
    'detects persisted stripped source through the original %s Task binding',
    async (phase) => {
      const fixture = await dockerSessionFixture()
      if (phase === 'terminal') {
        await fixture.store.tasks.settle(
          fixture.command,
          {
            ...taskExecutionIdentity(fixture.command),
            commandFingerprint: fixture.task.commandFingerprint,
            kind: 'execution.result',
            status: 'failed',
            receiptId: 'receipt:offline-terminal',
            outcomeRef: 'outcome:offline-terminal',
            artifactRefs: [],
            usageFactRefs: [],
            recordedAt: new Date(TASK_TEST_NOW).toISOString(),
            stopProof: {
              proofRef: 'proof:offline-fixture',
              evidenceKind: 'stopped',
              writersFenced: true,
              managedToolsSettled: true,
              recordedAt: new Date(TASK_TEST_NOW).toISOString()
            }
          },
          TASK_TEST_NOW
        )
        expect(fixture.store.tasks.listActive()).toEqual([])
      }
      const record = { ...fixture.record() }
      delete record.taskSource
      await fixture.store.transitionHandoff(record.sessionId, () => record)
      const owner = createTaskDockerSessionOwner({
        store: fixture.store,
        run: dockerOwnerRunner(fixture).run
      })
      expect(owner.classify(record)).toBe('unverifiable')
      expect(await owner.probe(record)).toEqual({ outcome: 'execution-host-unverifiable' })
      expect(await owner.stop(record)).toEqual({ outcome: 'execution-host-unverifiable' })
    }
  )
  it('refuses pending CID without invoking Docker or PID fallback', async () => {
    const fixture = await dockerSessionFixture(false, false)
    const runner = dockerOwnerRunner(fixture)
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    expect(await owner.probe(fixture.record())).toEqual({ outcome: 'execution-host-unverifiable' })
    expect(await owner.stop(fixture.record())).toEqual({ outcome: 'execution-host-unverifiable' })
    expect(runner.run).not.toHaveBeenCalled()
  })
  it.each(['daemon', 'cid', 'label', 'image', 'missing', 'never-started'] as const)(
    'returns unverifiable for %s rather than writer death',
    async (change) => {
      const fixture = await dockerSessionFixture()
      const runner = dockerOwnerRunner(fixture)
      if (change === 'daemon') {
        runner.daemon.ID = 'daemon:other'
      }
      if (change === 'cid') {
        runner.container.Id = 'c'.repeat(64)
      }
      if (change === 'label') {
        runner.container.Config.Labels['io.hive.task.execution'] = 'other:execution'
      }
      if (change === 'image') {
        runner.container.Image = `sha256:${'c'.repeat(64)}`
      }
      if (change === 'missing') {
        runner.missing()
      }
      if (change === 'never-started') {
        runner.container.State = {
          ...runner.container.State,
          Status: 'created',
          Running: false,
          Pid: 0,
          StartedAt: '0001-01-01T00:00:00Z'
        }
      }
      const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
      expect(await owner.probe(fixture.record())).toEqual({
        outcome: 'execution-host-unverifiable'
      })
      expect(await owner.stop(fixture.record())).toEqual({ outcome: 'execution-host-unverifiable' })
    }
  )
  it('cleans only the original CID across cancellation and workspace replacement', async () => {
    const fixture = await dockerSessionFixture()
    const runner = dockerOwnerRunner(fixture)
    await fixture.store.tasks.requestCancellation(
      fixture.command,
      'cancel:owner',
      TASK_TEST_NOW,
      fixture.validate
    )
    fixture.validate.mockImplementation(() => {
      throw new Error('original grant revoked')
    })
    await rename(
      fixture.task.workspace.executionPath,
      `${fixture.task.workspace.executionPath}-moved`
    )
    await mkdir(fixture.task.workspace.executionPath)
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    expect(await owner.stop(fixture.record())).toEqual({
      outcome: 'execution-host-exited',
      witness: executionWitness(fixture.record())
    })
    const kill = runner.run.mock.calls.find(([spec]) => spec.args?.[4] === 'kill')
    expect(kill?.[0].args).toContain(OWNER_CID)
    expect(
      runner.run.mock.calls.every(
        ([spec]) => spec.args?.[0] === '--config' && spec.args[1] === process.execPath
      )
    ).toBe(true)
  })
  it('keeps stop unproven when the original container remains live', async () => {
    const fixture = await dockerSessionFixture()
    const runner = dockerOwnerRunner(fixture)
    runner.keepLive()
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    expect(await owner.stop(fixture.record())).toEqual({ outcome: 'execution-host-unverifiable' })
    expect(fixture.record().lease.deathEvidence).toBeNull()
  })
  it('rejects stale session/fence results after awaiting the actual host runner', async () => {
    const fixture = await dockerSessionFixture()
    const runner = dockerOwnerRunner(fixture)
    let changed = false
    runner.before(async () => {
      if (!changed) {
        changed = true
        await fixture.store.transitionHandoff(fixture.record().sessionId, (record) => ({
          ...record,
          lease: { ...record.lease, reservedSpawnToken: 'other-token' }
        }))
      }
    })
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    expect(await owner.probe(fixture.record())).toEqual({ outcome: 'execution-host-unverifiable' })
  })
  it('preserves same-CID stop proof while the original journal append finishes', async () => {
    const fixture = await dockerSessionFixture()
    const runner = dockerOwnerRunner(fixture)
    const record = fixture.record()
    const journal = await journals.open({
      stateDirectory: fixture.directory,
      identity: {
        sessionId: record.sessionId,
        workspaceId: record.location.workspaceId,
        hostId: 'local',
        agent: 'codex',
        providerHandle: codexProviderHandle('thread-docker')
      }
    })
    const cursor = journal.cursor()
    let checkpointed = false
    runner.before(async () => {
      if (!checkpointed) {
        checkpointed = true
        await journal.appendLifecycleBatch({
          settlementId: 'original-journal-progress',
          fence: 1,
          mutations: [
            {
              kind: 'item',
              identity: { provider: 'orca', clientMessageId: 'original-journal-progress' },
              body: { kind: 'status', text: 'Synthetic journal progress', tone: 'info' },
              turnScope: AGENT_JOURNAL_THREAD_SCOPE
            }
          ]
        })
      }
    })
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    expect(await owner.stop(fixture.record())).toEqual({
      outcome: 'execution-host-exited',
      witness: executionWitness(fixture.record())
    })
    expect(journal.cursor()).toEqual({ ...cursor, sequence: cursor.sequence + 1 })
    expect(fixture.record().lease.runtimeFence).toBe(record.lease.runtimeFence)
  })
  it('bounds one readonly probe and prevents another or late Docker continuation', async () => {
    const fixture = await dockerSessionFixture()
    const runner = dockerOwnerRunner(fixture)
    const blocked = Promise.withResolvers<void>()
    runner.before(() => blocked.promise)
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    let settled = false
    const first = owner.probe(fixture.record()).then((value) => {
      settled = true
      return value
    })
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    vi.setSystemTime(Date.now() - 60_000)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    expect(await first).toEqual({ outcome: 'execution-host-unverifiable' })
    expect(await owner.probe(fixture.record())).toEqual({ outcome: 'execution-host-unverifiable' })
    expect(runner.run).toHaveBeenCalledOnce()
    blocked.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(runner.run).toHaveBeenCalledOnce()
    expect(fixture.record().lease.deathEvidence).toBeNull()
  })
  it('uses the shared remaining budget for readonly CLI calls and observes late rejection', async () => {
    const fixture = await dockerSessionFixture()
    const runner = dockerOwnerRunner(fixture)
    const blocked = Promise.withResolvers<void>()
    runner.before(() => blocked.promise)
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    const pending = owner.probe(fixture.record(), performance.now() + 500)
    await vi.advanceTimersByTimeAsync(500)
    expect(await pending).toEqual({ outcome: 'execution-host-unverifiable' })
    expect(runner.run.mock.calls[0]?.[0].timeoutMs).toBe(500)
    blocked.reject(new Error('late CLI failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(runner.run).toHaveBeenCalledOnce()
  })
})
