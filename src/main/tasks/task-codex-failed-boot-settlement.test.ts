import { resolve } from 'node:path'
import { lstat, mkdir } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalAgentSessionDigest,
  computeAgentSessionPayloadFingerprint
} from '../../shared/agent-session-mutation-envelope'
import * as durableWrite from '../durable-file-write'
import {
  closeTestJournalHostDatabases,
  openTestJournalHostDatabase,
  loadTestJournal
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { openAgentSessionJournal } from '../native-chat/agent-session-journal/journal-store-factory'
import { journalIdentityFor } from '../native-chat/agent-session-wire/structured-agent-session-attach'
import { attachParamsForRecord } from '../native-chat/agent-session-wire/structured-agent-session-conversation-open'
import { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { hostTestMessage } from '../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import { StructuredAgentSessionAdapterRouter } from '../native-chat/agent-session-wire/structured-agent-session-adapter-router'
import {
  AgentSessionAcquisitionRootExitObservedError,
  AgentSessionPreSpawnError
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { indexProviderChild } from '../native-chat/agent-session-wire/structured-agent-session-provider-child'
import {
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  readPersistedTestAgentSessionStoreText
} from '../runtime/agent-session-record-store-test-harness'
import { createTaskCodexEvidence } from './task-codex-evidence'
import { createTaskDockerSessionOwner } from './task-docker-session-owner'
import {
  dockerSessionFixture,
  dockerOwnerRunner,
  executionWitness
} from './task-docker-session-owner.test-fixture'
import { TaskExecutionRecordSchema, taskExecutionRecordKey } from './task-execution-record'
import { taskCancelledResult } from './task-cancelled-result'
import { collectTaskExecutionSettlement } from './task-execution-settlement'
import { taskStructuredFixture } from './task-structured-reservation.test-fixture'
import { taskDockerBinding } from './task-docker-identity'
import { TASK_TEST_NOW } from './task-execution.test-fixture'

const hosts: StructuredAgentSessionHost[] = []
afterEach(async () => {
  setStructuredAgentSessionHost(null)
  vi.restoreAllMocks()
  await Promise.all(hosts.splice(0).map((host) => host.flushAllStreamedEvents()))
  closeTestJournalHostDatabases()
})

async function failedBootFixture(
  options: { router?: boolean; cancelled?: boolean; indexed?: boolean } = {}
) {
  const f = await dockerSessionFixture(
    options.indexed === true,
    true,
    resolve('logs/paperclip-development/p3/task-failed-boot-settlement/tmp')
  )
  const original = f.record()
  if (!options.indexed) {
    await f.store.commitProcessIdentity({
      sessionId: original.sessionId,
      fence: original.lease.runtimeFence,
      process: {
        hostId: 'local',
        pid: 4242,
        processStartTimeMs: TASK_TEST_NOW,
        spawnToken: original.lease.reservedSpawnToken!
      },
      now: TASK_TEST_NOW
    })
  }
  await f.store.transitionHandoff(original.sessionId, (record) => ({
    ...record,
    lease: { ...record.lease, handoffStage: 'recovering' }
  }))
  if (options.cancelled !== false) {
    await f.store.tasks.requestCancellation(f.command, 'cancel:original', TASK_TEST_NOW, f.validate)
  }
  await f.store.tasks.markUnknown(f.command, TASK_TEST_NOW)
  const task = f.store.tasks.get(f.command)!
  const runner = dockerOwnerRunner(f)
  runner.exit()
  const owner = createTaskDockerSessionOwner({ store: f.store, run: runner.run })
  const acquire = vi.fn(async () => {
    throw new Error('settlement must never start a provider')
  })
  const dispatch = vi.fn(async () => ({ state: 'unknown' as const, reason: 'not dispatched' }))
  const acknowledge = vi.fn()
  const releaseAcquisition = vi.fn(async () => true)
  const disposeSession = vi.fn(async () => true)
  const claudeRelease = vi.fn(async () => true)
  const stop = vi.fn(owner.stop)
  const adapter = {
    acquire,
    dispatch,
    cancelTurn: vi.fn(async () => ({ cancelled: false })),
    answerPrompt: vi.fn(async () => undefined),
    setOption: vi.fn(async () => undefined),
    releaseAcquisition,
    disposeSession,
    acknowledgeSessionRelease: acknowledge
  }
  const host = new StructuredAgentSessionHost({
    store: f.store,
    adapter: options.router
      ? new StructuredAgentSessionAdapterRouter(
          {
            codex: adapter,
            claude: { ...adapter, releaseAcquisition: claudeRelease }
          },
          async () => {}
        )
      : adapter,
    journalDatabase: openTestJournalHostDatabase(f.directory),
    claimKeyId: 'claim-key-one',
    now: () => TASK_TEST_NOW + 1000,
    stopExecutionOwner: stop,
    probeOwner: async (record) =>
      (await owner.probe(record)) ?? { outcome: 'execution-host-unverifiable' }
  })
  hosts.push(host)
  setStructuredAgentSessionHost(host)
  if (options.indexed) {
    await host.journalSnapshot(original.sessionId)
    indexProviderChild(host.collaboratorsForTests().sessions.get(original.sessionId)!, {
      generation: 'original-indexed-child',
      fence: original.lease.runtimeFence,
      phase: 'ready'
    })
  }
  return {
    ...f,
    task,
    runner,
    host,
    stop,
    acquire,
    dispatch,
    acknowledge,
    releaseAcquisition,
    disposeSession,
    claudeRelease,
    evidence: createTaskCodexEvidence(resolve(f.directory, 'artifacts'))
  }
}

describe('original cancelled Codex Task failed-boot settlement', () => {
  it('proves a started and exited unpublished launch through the original owner and close', async () => {
    const f = await failedBootFixture()
    const original = f.record()
    expect(f.host.hasSession(original.sessionId)).toBe(false)
    expect(await f.evidence.stop(f.task)).toMatchObject({
      evidenceKind: 'stopped',
      managedToolsSettled: true,
      writersFenced: true
    })
    expect(f.stop).toHaveBeenCalledTimes(1)
    expect(f.acknowledge).toHaveBeenCalledTimes(1)
    expect(f.releaseAcquisition).toHaveBeenCalledOnce()
    expect(f.host.hasSession(original.sessionId)).toBe(false)
    expect(f.record().lease).toMatchObject({
      claimStatus: 'released',
      runtimeFence: original.lease.runtimeFence + 1,
      unreconciled: false,
      ownerProcess: null,
      reservedSpawnToken: null,
      deathEvidence: {
        kind: 'execution-host-exit-observed',
        witness: executionWitness(original)
      }
    })
    const persisted = await readPersistedTestAgentSessionStore(f.directory)
    expect(persisted.records[original.sessionId]?.lease).toEqual(f.record().lease)
    expect(persisted.taskExecutions[taskExecutionRecordKey(f.command)]).toMatchObject({
      dispatch: 'dispatching',
      launch: null,
      cancellationKey: 'cancel:original'
    })
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
    expect(f.store.tasks.get(f.command)?.modelDispatchAttempts ?? 0).toBe(0)
    expect(
      f.runner.run.mock.calls.every(
        ([spec]) => !spec.args?.some((arg) => ['create', 'start', 'exec'].includes(arg))
      )
    ).toBe(true)
  })

  it('abandons an original queued submission while holding the session lock without starting it', async () => {
    const f = await failedBootFixture()
    const record = f.record()
    const params = attachParamsForRecord(record, {
      clientOperationId: 'original-journal',
      expectedRuntimeFence: record.lease.runtimeFence
    })
    const journal = await openAgentSessionJournal({
      identity: journalIdentityFor(record, params),
      database: openTestJournalHostDatabase(f.directory)
    })
    const body = hostTestMessage('original queued prompt')
    await journal.appendSubmission({
      fence: record.lease.runtimeFence,
      clientMessageId: 'original-queued-prompt',
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: record.sessionId,
        fields: { body }
      }),
      body,
      handoverRecorded: true
    })
    await journal.close()
    expect(await f.evidence.stop(f.task)).toMatchObject({ evidenceKind: 'stopped' })
    expect(
      loadTestJournal(f.directory, record.sessionId)?.state.submissions.get(
        'original-queued-prompt'
      )
    ).toMatchObject({ dispatchState: 'rejected' })
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
  })

  it('settles the original Task store as cancelled/stopped without publishing a launch', async () => {
    const f = await failedBootFixture()
    const launch = vi.fn(async () => {
      throw new Error('settlement cannot launch')
    })
    await collectTaskExecutionSettlement(
      {
        store: f.store.tasks,
        capabilities: () => undefined,
        authorize: async () => {
          throw new Error('already admitted original task')
        },
        launch,
        ...f.evidence
      },
      f.task,
      undefined,
      () => TASK_TEST_NOW + 1000
    )
    const settled = f.store.tasks.get(f.command)!
    expect(settled).toMatchObject({
      status: 'cancelled',
      dispatch: 'dispatching',
      launch: null,
      result: { status: 'cancelled', stopProof: { evidenceKind: 'stopped' } }
    })
    expect(
      (await readPersistedTestAgentSessionStore(f.directory)).taskExecutions[
        taskExecutionRecordKey(f.command)
      ]
    ).toEqual(settled)
    expect(launch).not.toHaveBeenCalled()
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    'missing-binding',
    'missing-cid',
    'account',
    'location',
    'source',
    'fence',
    'token',
    'unreconciled'
  ])('keeps %s unknown before invoking the original owner', async (field) => {
    const f = await failedBootFixture()
    await editPersistedTestAgentSessionStore(f.directory, (persisted) => {
      const task = persisted.taskExecutions[taskExecutionRecordKey(f.command)]!
      const session = persisted.records[f.record().sessionId]!
      if (field === 'missing-binding') {
        delete task.structuredBinding
      }
      if (field === 'missing-cid') {
        task.dockerIdentity!.containerId = null
      }
      if (field === 'account') {
        session.accountHome = { variable: 'CODEX_HOME', path: '/replacement-home' }
      }
      if (field === 'location') {
        session.location.workspaceId = 'replacement-workspace'
      }
      if (field === 'source') {
        session.taskSource!.ownershipEpoch += 1
      }
      if (field === 'fence') {
        session.lease.runtimeFence += 1
      }
      if (field === 'token') {
        session.lease.reservedSpawnToken = 'replacement-spawn'
      }
      if (field === 'unreconciled') {
        session.lease.unreconciled = true
      }
    })
    expect(await f.evidence.stop(f.task)).toBeNull()
    expect(f.stop).not.toHaveBeenCalled()
    expect(f.acquire).not.toHaveBeenCalled()
  })

  it('refuses a positive-looking no-op close without exact death and transport close', async () => {
    const f = await failedBootFixture()
    Object.defineProperty(f.host, 'closeTaskExecution', { value: async () => undefined })
    expect(await f.evidence.stop(f.task)).toBeNull()
    expect(f.record().lease.deathEvidence).toBeNull()
    expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it('requires positive close completion even with preexisting exact Docker death', async () => {
    const f = await failedBootFixture()
    const original = f.record()
    await f.store.evictProvenDeadOwner({
      sessionId: original.sessionId,
      expectedFence: original.lease.runtimeFence,
      probe: { outcome: 'execution-host-exited', witness: executionWitness(original) },
      now: TASK_TEST_NOW + 1000
    })
    Object.defineProperty(f.host, 'closeTaskExecution', { value: async () => undefined })
    expect(f.host.hasSession(original.sessionId)).toBe(false)
    expect(f.record().lease.deathEvidence?.kind).toBe('execution-host-exit-observed')
    expect(await f.evidence.stop(f.task)).toBeNull()
    expect(f.releaseAcquisition).not.toHaveBeenCalled()
  })

  it.each(['pid-absent', 'exit-observed', 'identity-mismatch'] as const)(
    'never spends generic %s process evidence as original Docker death',
    async (kind) => {
      const f = await failedBootFixture()
      await f.store.transitionHandoff(f.record().sessionId, (record) => ({
        ...record,
        lease: {
          ...record.lease,
          claimStatus: 'released',
          runtimeFence: record.lease.runtimeFence + 1,
          ownerProcess: null,
          reservedSpawnToken: null,
          deathEvidence: {
            kind,
            detail: 'generic process observation',
            observedAt: TASK_TEST_NOW + 1000
          }
        }
      }))
      Object.defineProperty(f.host, 'closeTaskExecution', { value: async () => true })
      expect(await f.evidence.stop(f.task)).toBeNull()
      expect(f.stop).not.toHaveBeenCalled()
      expect(f.acquire).not.toHaveBeenCalled()
    }
  )

  it('keeps exact Docker death unknown when original acquisition transport close refuses', async () => {
    const f = await failedBootFixture()
    f.releaseAcquisition.mockResolvedValue(false)
    expect(await f.evidence.stop(f.task)).toBeNull()
    expect(f.record().lease.deathEvidence).toBeNull()
    expect(f.stop).not.toHaveBeenCalled()
    expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it('requires Codex cleanup despite a positive sibling and retains the original retry', async () => {
    const f = await failedBootFixture({ router: true })
    f.releaseAcquisition.mockResolvedValueOnce(false)
    expect(await f.evidence.stop(f.task)).toBeNull()
    expect(f.claudeRelease).not.toHaveBeenCalled()
    expect(f.stop).not.toHaveBeenCalled()
    expect(await f.evidence.stop(f.task)).toMatchObject({ evidenceKind: 'stopped' })
    expect(f.releaseAcquisition).toHaveBeenCalledTimes(2)
    expect(f.claudeRelease).not.toHaveBeenCalled()
    expect(f.acquire).not.toHaveBeenCalled()
  })

  it('does not spend root-exit cleanup evidence with unproven descendants', async () => {
    const f = await failedBootFixture()
    f.releaseAcquisition.mockRejectedValueOnce(
      new AgentSessionAcquisitionRootExitObservedError(new Error('descendants unsettled'))
    )
    expect(await f.evidence.stop(f.task)).toBeNull()
    expect(f.stop).not.toHaveBeenCalled()
    expect(f.record().lease.deathEvidence).toBeNull()
  })

  it('keeps an unpublished uncancelled Task unknown', async () => {
    const f = await failedBootFixture({ cancelled: false })
    expect(await f.evidence.stop(f.task)).toBeNull()
    expect(f.stop).not.toHaveBeenCalled()
  })

  it('keeps a Task recovery-blocked store unknown', async () => {
    const f = await failedBootFixture()
    await editPersistedTestAgentSessionStore(f.directory, (persisted) => {
      Object.defineProperty(persisted, 'taskRecoveryBlocked', { value: true, enumerable: true })
    })
    expect(await f.evidence.stop(f.task)).toBeNull()
    expect(f.stop).not.toHaveBeenCalled()
  })

  it('rechecks the exact original Task after the conversation open awaited', async () => {
    const f = await failedBootFixture()
    f.host.deps.adapter.historyFilePath = async () => {
      await editPersistedTestAgentSessionStore(f.directory, (persisted) => {
        const task = persisted.taskExecutions[taskExecutionRecordKey(f.command)]!
        task.structuredBinding!.spawnToken = 'replacement-task-spawn'
      })
      return null
    }
    expect(await f.evidence.stop(f.task)).toBeNull()
    expect(f.stop).not.toHaveBeenCalled()
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.record().lease.deathEvidence).toBeNull()
  })

  it('serializes behind an in-flight original acquisition before proving its stop', async () => {
    const f = await failedBootFixture()
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const originalAcquisition = f.host
      .collaboratorsForTests()
      .serialize(f.record().sessionId, async () => {
        entered()
        await held
      })
    await started
    let settled = false
    const stopping = f.evidence.stop(f.task).then((proof) => {
      settled = true
      return proof
    })
    await f.store.tasks.readActive(() => undefined)
    expect(settled).toBe(false)
    expect(f.stop).not.toHaveBeenCalled()
    release()
    await originalAcquisition
    expect(await stopping).toMatchObject({ evidenceKind: 'stopped' })
    expect(f.acquire).not.toHaveBeenCalled()
  })

  it('keeps failed original death persistence unknown', async () => {
    const f = await failedBootFixture()
    const before = await readPersistedTestAgentSessionStoreText(f.directory)
    vi.spyOn(durableWrite, 'writeTempFileDurable').mockRejectedValue(
      new Error('death-write-failed')
    )
    expect(await f.evidence.stop(f.task)).toBeNull()
    expect(await readPersistedTestAgentSessionStoreText(f.directory)).toBe(before)
    expect(f.record().lease.deathEvidence).toBeNull()
    expect(f.acknowledge).not.toHaveBeenCalled()
  })

  it.each(['root-exit', 'pre-spawn', 'false'] as const)(
    'retains indexed Task child and debt on partial %s cleanup, then retries strictly',
    async (failure) => {
      const f = await failedBootFixture({ indexed: true })
      f.disposeSession.mockImplementationOnce(async () => {
        if (failure === 'false') {
          return false
        }
        throw failure === 'root-exit'
          ? new AgentSessionAcquisitionRootExitObservedError(new Error('unsettled descendants'))
          : new AgentSessionPreSpawnError(new Error('processless verdict'))
      })
      expect(await f.evidence.stop(f.task)).toBeNull()
      const session = f.host.collaboratorsForTests().sessions.get(f.record().sessionId)!
      expect(session.child).toMatchObject({ generation: 'original-indexed-child', fence: 1 })
      expect(session.owesProviderChildWindDown).toMatchObject({
        generation: 'original-indexed-child',
        fence: 1
      })
      expect(f.stop).not.toHaveBeenCalled()
      expect(f.record().lease.deathEvidence).toBeNull()
      expect(f.store.tasks.get(f.command)?.result).toBeNull()
      expect(await f.evidence.stop(f.task)).toMatchObject({ evidenceKind: 'stopped' })
      expect(f.host.hasSession(f.record().sessionId)).toBe(false)
      expect(f.disposeSession).toHaveBeenCalledTimes(2)
      expect(f.acquire).not.toHaveBeenCalled()
      expect(f.dispatch).not.toHaveBeenCalled()
    }
  )

  it('requires the captured stopping Task for a direct unpublished cancelled/stopped commit', async () => {
    const f = await failedBootFixture()
    expect(await f.evidence.stop(f.task)).toMatchObject({ evidenceKind: 'stopped' })
    await expect(
      f.store.tasks.settle(
        f.command,
        taskCancelledResult(f.task, 'stopped', TASK_TEST_NOW + 1000),
        TASK_TEST_NOW + 1000
      )
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.store.tasks.get(f.command)?.result).toBeNull()
    expect(
      (await readPersistedTestAgentSessionStore(f.directory)).taskExecutions[
        taskExecutionRecordKey(f.command)
      ]?.result
    ).toBeNull()
    expect(
      (await openTestAgentSessionRecordStore(f.directory)).tasks.get(f.command)?.result
    ).toBeNull()
  })

  it('refuses a supplied stopping snapshot that omits the original structured binding', async () => {
    const f = await failedBootFixture()
    expect(await f.evidence.stop(f.task)).toMatchObject({ evidenceKind: 'stopped' })
    await expect(
      f.store.tasks.settle(
        f.command,
        taskCancelledResult(f.task, 'stopped', TASK_TEST_NOW + 1000),
        TASK_TEST_NOW + 1000,
        { ...f.task, structuredBinding: undefined }
      )
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.store.tasks.get(f.command)?.result).toBeNull()
    expect(
      (await readPersistedTestAgentSessionStore(f.directory)).taskExecutions[
        taskExecutionRecordKey(f.command)
      ]?.result
    ).toBeNull()
  })

  it.each(['binding', 'session-owner', 'unreconciled', 'quarantine', 'recovery-blocked'] as const)(
    'rechecks %s inside final receipt lock after positive original stop',
    async (field) => {
      const f = await failedBootFixture()
      const commit = f.store.tasks.settle.bind(f.store.tasks)
      vi.spyOn(f.store.tasks, 'settle').mockImplementationOnce(async (...args) => {
        expect(f.record().lease.deathEvidence?.kind).toBe('execution-host-exit-observed')
        expect(f.host.hasSession(f.record().sessionId)).toBe(false)
        await (field === 'session-owner' || field === 'unreconciled'
          ? f.store.transitionHandoff(f.record().sessionId, (record) => ({
              ...record,
              lease:
                field === 'unreconciled'
                  ? { ...record.lease, unreconciled: true }
                  : {
                      ...record.lease,
                      runtimeFence: record.lease.runtimeFence + 1,
                      reservedSpawnToken: 'replacement-session-owner',
                      ownerProcess: {
                        hostId: 'local',
                        pid: 4343,
                        processStartTimeMs: TASK_TEST_NOW + 1000,
                        spawnToken: 'replacement-session-owner'
                      },
                      claimStatus: 'reserved',
                      handoffStage: 'new-owner-proving',
                      deathEvidence: null
                    }
            }))
          : editPersistedTestAgentSessionStore(f.directory, (persisted) => {
              if (field === 'binding') {
                persisted.taskExecutions[
                  taskExecutionRecordKey(f.command)
                ]!.structuredBinding!.accountHome.path = '/replacement-original-binding'
              }
              if (field === 'quarantine') {
                persisted.unusableRecords[f.record().sessionId] = {
                  reason: 'original-session-quarantined',
                  raw: persisted.records[f.record().sessionId]
                }
              }
              if (field === 'recovery-blocked') {
                Object.defineProperty(persisted, 'taskRecoveryBlocked', {
                  value: true,
                  enumerable: true
                })
              }
            }))
        expect(
          TaskExecutionRecordSchema.safeParse(
            (await readPersistedTestAgentSessionStore(f.directory)).taskExecutions[
              taskExecutionRecordKey(f.command)
            ]
          ).success
        ).toBe(true)
        return commit(...args)
      })
      await expect(
        collectTaskExecutionSettlement(
          {
            store: f.store.tasks,
            capabilities: () => undefined,
            authorize: async () => {
              throw new Error('already admitted original task')
            },
            launch: async () => {
              throw new Error('must not relaunch')
            },
            ...f.evidence
          },
          f.task,
          undefined,
          () => TASK_TEST_NOW + 1000
        )
      ).rejects.toThrow('OUTCOME_UNKNOWN')
      expect(f.store.tasks.get(f.command)?.result).toBeNull()
      expect(f.store.tasks.get(f.command)?.status).toBe('outcome_unknown')
      expect(
        (await readPersistedTestAgentSessionStore(f.directory)).taskExecutions[
          taskExecutionRecordKey(f.command)
        ]?.result
      ).toBeNull()
      expect(
        (await openTestAgentSessionRecordStore(f.directory)).tasks.get(f.command)?.result
      ).toBeNull()
      expect(f.acquire).not.toHaveBeenCalled()
      expect(f.dispatch).not.toHaveBeenCalled()
    }
  )

  it('never settles a live original Task using another valid stopped Task in the same store', async () => {
    const f = await failedBootFixture({ indexed: true })
    const executionPath = resolve(f.directory, 'other-execution')
    await mkdir(executionPath)
    const stat = await lstat(executionPath, { bigint: true })
    const other = taskStructuredFixture(
      {
        ...f.task.workspace,
        workspaceId: 'other-workspace',
        executionPath,
        directoryIdentity: {
          dev: String(stat.dev),
          ino: String(stat.ino),
          birthtimeNs: String(stat.birthtimeNs)
        }
      },
      undefined,
      {
        executionId: 'execution:other-stopped',
        operationId: `${TASK_TEST_NOW}-${'c'.repeat(32)}`,
        idempotencyKey: 'start:other-stopped',
        workspaceExecutionClaimRef: 'workspace-claim:other-stopped',
        task: { ...f.command.task, taskId: 'task:other-stopped', runId: 'run:other-stopped' }
      }
    )
    await f.store.tasks.admit(other.admission)
    await f.store.tasks.beginDispatch(other.command, TASK_TEST_NOW, other.validate)
    await f.store.admitOperation({
      callerKey: other.origin.operationCallerKey,
      operationId: other.origin.operationId,
      fingerprint: other.origin.launchFingerprint,
      now: TASK_TEST_NOW
    })
    await f.store.claimOperation({
      callerKey: other.origin.operationCallerKey,
      operationId: other.origin.operationId
    })
    const sessionId = 'session-other-stopped'
    const reserved = await f.store.reserveOwner({
      ...other.request,
      sessionId,
      spawnToken: 'other-original-spawn',
      operation: {
        ...other.request.operation,
        fingerprint: canonicalAgentSessionDigest({ method: 'agentSession.attach', sessionId })
      }
    })
    const bound = f.store.tasks.get(other.command)!
    const pending = { ...f.pending, ...taskDockerBinding(bound), containerId: null }
    const containerId = 'c'.repeat(64)
    await f.store.tasks.persistDockerIdentity(other.command, pending, TASK_TEST_NOW, other.validate)
    await f.store.tasks.persistDockerIdentity(
      other.command,
      { ...pending, containerId },
      TASK_TEST_NOW,
      other.validate
    )
    await f.store.tasks.requestCancellation(
      other.command,
      'cancel:other-stopped',
      TASK_TEST_NOW,
      other.validate
    )
    await f.store.tasks.markUnknown(other.command, TASK_TEST_NOW)
    await f.store.evictProvenDeadOwner({
      sessionId,
      expectedFence: reserved.record.lease.runtimeFence,
      probe: {
        outcome: 'execution-host-exited',
        witness: { ...executionWitness(reserved.record), containerId }
      },
      now: TASK_TEST_NOW + 1000
    })
    const stopping = f.store.tasks.get(other.command)!
    expect(TaskExecutionRecordSchema.safeParse(stopping).success).toBe(true)
    expect((await f.store.tasks.assertFailedBootStopCurrent(stopping, true)).sessionId).toBe(
      sessionId
    )
    expect(f.record().lease).toMatchObject({ claimStatus: 'live', deathEvidence: null })
    await expect(
      f.store.tasks.settle(
        f.command,
        taskCancelledResult(f.task, 'stopped', TASK_TEST_NOW + 1000),
        TASK_TEST_NOW + 1000,
        stopping
      )
    ).rejects.toThrow(/OUTCOME_UNKNOWN|IDEMPOTENCY_CONFLICT/)
    expect(f.store.tasks.get(f.command)?.result).toBeNull()
    expect(f.record().lease).toMatchObject({ claimStatus: 'live', deathEvidence: null })
    expect(
      (await readPersistedTestAgentSessionStore(f.directory)).taskExecutions[
        taskExecutionRecordKey(f.command)
      ]?.result
    ).toBeNull()
    expect(
      (await openTestAgentSessionRecordStore(f.directory)).tasks.get(f.command)?.result
    ).toBeNull()
    expect(f.stop).not.toHaveBeenCalled()
    const correct = await f.store.tasks.settle(
      other.command,
      taskCancelledResult(stopping, 'stopped', TASK_TEST_NOW + 1000),
      TASK_TEST_NOW + 1000,
      stopping
    )
    expect(correct.record).toMatchObject({
      status: 'cancelled',
      result: { stopProof: { evidenceKind: 'stopped' } }
    })
    expect(f.store.tasks.get(f.command)?.result).toBeNull()
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.dispatch).not.toHaveBeenCalled()
  })

  it.each(['caller', 'workspace', 'context'] as const)(
    'refuses the same target with a mismatching captured %s snapshot',
    async (field) => {
      const f = await failedBootFixture()
      expect(await f.evidence.stop(f.task)).toMatchObject({ evidenceKind: 'stopped' })
      const stopping = structuredClone(f.task)
      if (field === 'caller') {
        stopping.operationCallerKey = 'caller:other-original'
      }
      if (field === 'workspace') {
        stopping.workspace.canonicalPath = resolve(f.directory, 'other-original-workspace')
      }
      if (field === 'context') {
        stopping.command.profileRevision = 'profile:other-original'
      }
      await expect(
        f.store.tasks.settle(
          f.command,
          taskCancelledResult(f.task, 'stopped', TASK_TEST_NOW + 1000),
          TASK_TEST_NOW + 1000,
          stopping
        )
      ).rejects.toThrow(/OUTCOME_UNKNOWN|IDEMPOTENCY_CONFLICT/)
      expect(f.store.tasks.get(f.command)?.result).toBeNull()
      expect(
        (await readPersistedTestAgentSessionStore(f.directory)).taskExecutions[
          taskExecutionRecordKey(f.command)
        ]?.result
      ).toBeNull()
      const correct = await f.store.tasks.settle(
        f.command,
        taskCancelledResult(f.task, 'stopped', TASK_TEST_NOW + 1000),
        TASK_TEST_NOW + 1000,
        f.task
      )
      expect(correct.record.result?.status).toBe('cancelled')
      expect(f.acquire).not.toHaveBeenCalled()
    }
  )
})
