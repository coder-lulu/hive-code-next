import { rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import {
  TaskExecutionHost,
  type TaskExecutionHostDependencies,
  type TaskExecutionStopEvidence
} from './task-execution-host'
import {
  taskCommand,
  taskCapabilities,
  taskStopEvidence,
  taskTestDirectory,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

let directory: string
let deps: TaskExecutionHostDependencies
let host: TaskExecutionHost
beforeEach(async () => {
  directory = await taskTestDirectory()
  const store = await openTestAgentSessionRecordStore(directory)
  deps = {
    store: store.tasks,
    capabilities: () => taskCapabilities(),
    now: () => TASK_TEST_NOW,
    authorize: vi.fn(async () => ({
      workspace: taskWorkspace(directory),
      input: 'Create report.md.',
      assertCurrent: () => undefined
    })),
    launch: vi.fn(async () => TASK_TEST_LAUNCH),
    collect: vi.fn(async () => null),
    stop: vi.fn(async (record) => taskStopEvidence(record)),
    evidenceTimeoutMs: 5000
  }
  host = new TaskExecutionHost(deps)
})
afterEach(async () => {
  await host.drain()
  await rm(directory, { recursive: true, force: true })
})

async function query() {
  const receipt = await host.start(taskCommand(), TASK_TEST_CALLER)
  return {
    protocolVersion: 1,
    runtimeRecordId: receipt.runtimeRecordId,
    ownershipEpoch: receipt.ownershipEpoch,
    executionId: receipt.executionId,
    executionEpoch: receipt.executionEpoch,
    commandFingerprint: receipt.commandFingerprint,
    authorizationRef: taskCommand().authorizationRef,
    authorizationRevision: taskCommand().authorizationRevision,
    expiresAt: taskCommand().expiresAt,
    kind: 'execution.reconcile'
  }
}
async function cancelQuery() {
  return {
    ...(await query()),
    kind: 'execution.cancel',
    task: taskCommand().task,
    idempotencyKey: 'cancel:one',
    reason: 'user_requested'
  }
}

describe('local task host admission and evidence boundaries', () => {
  it('returns the same accepted receipt and dispatches once under concurrent starts', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => host.start(taskCommand(), TASK_TEST_CALLER))
    )
    expect(results.every((receipt) => receipt.receiptId === results[0].receiptId)).toBe(true)
    await host.reconcile(await query(), TASK_TEST_CALLER)
    expect(deps.launch).toHaveBeenCalledTimes(1)
  })
  it('does not treat acceptance, a launch receipt or an idle session as task completion', async () => {
    const observation = await host.reconcile(await query(), TASK_TEST_CALLER)
    expect(observation.status).toBe('running')
    expect(observation.result).toBeNull()
    expect(deps.stop).not.toHaveBeenCalled()
  })
  it.each(['command', 'cwd', 'env', 'principal', 'operationCallerKey'])(
    'rejects arbitrary %s before calling launch',
    async (key) => {
      await expect(
        host.start({ ...taskCommand(), [key]: 'unsafe' }, TASK_TEST_CALLER)
      ).rejects.toThrow('INVALID_REQUEST')
      expect(deps.launch).not.toHaveBeenCalled()
      expect(deps.authorize).not.toHaveBeenCalled()
    }
  )
  it('requires replay capabilities before recording any admission', async () => {
    deps.capabilities = () => ({ ...taskCapabilities(), capabilities: [] })
    await expect(host.start(taskCommand(), TASK_TEST_CALLER)).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(deps.store.get(taskCommand())).toBeNull()
    expect(deps.launch).not.toHaveBeenCalled()
  })
  it('rejects explicit resource requirements rather than stripping them', async () => {
    await expect(
      host.start(
        {
          ...taskCommand(),
          resourceSnapshotRef: 'snapshot:one',
          resourceSnapshotDigest: 'a'.repeat(64),
          manifestVersion: '1',
          resolverVersion: '1',
          requiredCoverage: 'managed_only',
          resourceScopeRef: 'scope:one'
        },
        TASK_TEST_CALLER
      )
    ).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    expect(deps.store.get(taskCommand())).toBeNull()
  })
  it.each([
    { ownerScope: { kind: 'teamSpace', teamSpaceRef: 'team:one' } },
    {
      executionPolicy: {
        trustMode: 'enforced_autonomous',
        executionPolicyRef: 'policy:team',
        executionPolicyRevision: '1',
        enforcementEvidenceRef: 'evidence:unverified'
      }
    },
    {
      ownerScope: { kind: 'teamSpace', teamSpaceRef: 'team:one' },
      executionPolicy: {
        trustMode: 'enforced_autonomous',
        executionPolicyRef: 'policy:team',
        executionPolicyRevision: '1',
        enforcementEvidenceRef: 'evidence:unverified'
      }
    }
  ])('rejects unsupported execution policy before effects: %j', async (patch) => {
    deps.capabilities = () => ({
      ...taskCapabilities(),
      capabilities: [...taskCapabilities().capabilities, 'task.enforcement.v1']
    })
    await expect(host.start({ ...taskCommand(), ...patch }, TASK_TEST_CALLER)).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(deps.store.get(taskCommand())).toBeNull()
    expect(deps.authorize).not.toHaveBeenCalled()
    expect(deps.launch).not.toHaveBeenCalled()
  })
  it('rejects expired authorization before recording an admission', async () => {
    await expect(
      host.start(
        { ...taskCommand(), expiresAt: new Date(TASK_TEST_NOW).toISOString() },
        TASK_TEST_CALLER
      )
    ).rejects.toThrow('FORBIDDEN')
    expect(deps.store.get(taskCommand())).toBeNull()
  })
  it('keeps a failed or unconfirmed launch unknown and never retries it', async () => {
    deps.launch = vi.fn(async () => {
      throw new Error('reply lost after spawning')
    })
    const request = await query()
    const observation = await host.reconcile(request, TASK_TEST_CALLER)
    expect(observation.status).toBe('outcome_unknown')
    await host.start(taskCommand(), TASK_TEST_CALLER)
    expect(deps.launch).toHaveBeenCalledTimes(1)
  })
  it('publishes a success only after host-owned artifact and matching stop proof', async () => {
    deps.collect = vi.fn(async () => ({
      outcomeRef: 'outcome:one',
      artifactRefs: ['artifact:report']
    }))
    const observation = await host.reconcile(await query(), TASK_TEST_CALLER)
    expect(observation.result?.status).toBe('succeeded')
    expect(observation.result?.artifactRefs).toEqual(['artifact:report'])
    expect(observation.result?.stopProof.managedToolsSettled).toBe(true)
  })
  it('keeps the writer occupied when stop proof belongs to another execution', async () => {
    deps.stop = vi.fn(async (record) => ({
      ...taskStopEvidence(record),
      writeFence: record.command.writeFence + 1
    }))
    const observation = await host.cancel(await cancelQuery(), TASK_TEST_CALLER)
    expect(observation.status).toBe('outcome_unknown')
    expect(observation.result).toBeNull()
  })
  it('cancels only after the managed writer and tools have stopped', async () => {
    const observation = await host.cancel(await cancelQuery(), TASK_TEST_CALLER)
    expect(observation.status).toBe('cancelled')
    expect(observation.result?.status).toBe('cancelled')
    expect(deps.stop).toHaveBeenCalledTimes(1)
  })
  it('deduplicates concurrent cancellation settlement', async () => {
    const request = await cancelQuery()
    const outcomes = await Promise.all([
      host.cancel(request, TASK_TEST_CALLER),
      host.cancel(request, TASK_TEST_CALLER)
    ])
    expect(outcomes[0].result?.receiptId).toBe(outcomes[1].result?.receiptId)
    expect(deps.stop).toHaveBeenCalledTimes(1)
  })
  it('prevents a late spawn after cancellation commits during launch preparation', async () => {
    let releasePreparation!: () => void
    let enteredPreparation!: () => void
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    const entered = new Promise<void>((resolve) => {
      enteredPreparation = resolve
    })
    const spawn = vi.fn()
    deps.launch = vi.fn(async (_record, authorization) => {
      enteredPreparation()
      await preparation
      authorization.assertCurrent()
      spawn()
      return TASK_TEST_LAUNCH
    })
    deps.stop = vi.fn(async () => null)
    host = new TaskExecutionHost({ ...deps, evidenceTimeoutMs: 50 })
    const request = await cancelQuery()
    await entered
    try {
      const observation = await host.cancel(request, TASK_TEST_CALLER)
      expect(observation.status).toBe('outcome_unknown')
      expect(observation.result).toBeNull()
    } finally {
      releasePreparation()
      await host.drain()
    }
    expect(spawn).not.toHaveBeenCalled()
    const record = deps.store.get(taskCommand())!
    expect(record.status).toBe('outcome_unknown')
    expect(record.launch).toBeNull()
    await expect(
      host.start(
        taskCommand({
          executionId: 'execution:another',
          operationId: `${TASK_TEST_NOW}-${'c'.repeat(32)}`,
          idempotencyKey: 'idempotency:another',
          workspaceExecutionClaimRef: 'claim:another',
          task: { ...taskCommand().task, taskId: 'task:another', runId: 'run:another' }
        }),
        TASK_TEST_CALLER
      )
    ).rejects.toThrow('WORKSPACE_BUSY')
  })
  it('does not disclose execution state to another caller', async () => {
    const request = await query()
    await host.reconcile(request, TASK_TEST_CALLER)
    await expect(
      host.reconcile(request, { operationCallerKey: 'service:another' })
    ).rejects.toThrow('EXECUTION_NOT_FOUND')
  })
  it('stops a cancellation that arrives while the candidate read is pending', async () => {
    let finishRead!: (candidate: null) => void
    let readStarted!: () => void
    const started = new Promise<void>((resolve) => {
      readStarted = resolve
    })
    let cancellationRecorded!: () => void
    const recorded = new Promise<void>((resolve) => {
      cancellationRecorded = resolve
    })
    const requestCancellation = deps.store.requestCancellation.bind(deps.store)
    vi.spyOn(deps.store, 'requestCancellation').mockImplementation(async (...args) => {
      const result = await requestCancellation(...args)
      cancellationRecorded()
      return result
    })
    deps.collect = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finishRead = resolve
          readStarted()
        })
    )
    host = new TaskExecutionHost({ ...deps, evidenceTimeoutMs: 5000 })
    const request = await query()
    const reconciliation = host.reconcile(request, TASK_TEST_CALLER)
    await started
    const cancellation = host.cancel(
      {
        ...request,
        kind: 'execution.cancel',
        task: taskCommand().task,
        idempotencyKey: 'cancel:pending-read',
        reason: 'user_requested'
      },
      TASK_TEST_CALLER
    )
    await recorded
    await new Promise((resolve) => setTimeout(resolve, 0))
    finishRead(null)
    await reconciliation
    expect((await cancellation).status).toBe('cancelled')
    expect(deps.stop).toHaveBeenCalledTimes(1)
  })
  it('retains an unknown outcome when the collector returns invalid references', async () => {
    deps.collect = vi.fn(async () => ({ outcomeRef: '', artifactRefs: [] }))
    const observation = await host.reconcile(await query(), TASK_TEST_CALLER)
    expect(observation.status).toBe('outcome_unknown')
    expect(observation.result).toBeNull()
  })
  it('bounds a stalled evidence read and retains unknown cancellation', async () => {
    deps.stop = vi.fn(() => new Promise<TaskExecutionStopEvidence | null>(() => undefined))
    // The real clock, rather than an injected logical clock, owns I/O deadlines.
    deps.now = Date.now
    host = new TaskExecutionHost({ ...deps, now: Date.now, evidenceTimeoutMs: 100 })
    const command = { ...taskCommand(), expiresAt: new Date(Date.now() + 60_000).toISOString() }
    const accepted = await host.start(command, TASK_TEST_CALLER)
    const observation = await host.cancel(
      {
        protocolVersion: 1,
        runtimeRecordId: command.runtimeRecordId,
        ownershipEpoch: command.ownershipEpoch,
        executionId: command.executionId,
        executionEpoch: command.executionEpoch,
        commandFingerprint: accepted.commandFingerprint,
        authorizationRef: command.authorizationRef,
        authorizationRevision: command.authorizationRevision,
        expiresAt: command.expiresAt,
        kind: 'execution.cancel',
        task: command.task,
        idempotencyKey: 'cancel:one',
        reason: 'user_requested'
      },
      TASK_TEST_CALLER
    )
    expect(observation.status).toBe('outcome_unknown')
    expect(observation.result).toBeNull()
  })
})
