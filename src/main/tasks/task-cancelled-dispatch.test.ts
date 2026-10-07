import { rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveAgentLaunchChildOperationId } from '../../shared/agent-launch-operation'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  editPersistedTestAgentSessionStore
} from '../runtime/agent-session-record-store-test-harness'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { TaskExecutionHost } from './task-execution-host'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { TaskExecutionRecordSchema, taskExecutionRecordKey } from './task-execution-record'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import {
  TaskStructuredBindingSchema,
  taskSessionSourceReference
} from '../../shared/task-execution/task-structured-binding'
import { agentSessionOperationKey } from '../../shared/agent-session-operation-ledger'
import {
  taskCommand,
  taskWorkspace,
  taskTestDirectory,
  TASK_TEST_CALLER,
  TASK_TEST_NOW,
  taskCapabilities
} from './task-execution.test-fixture'

let directory: string
let store: AgentSessionRecordStore
const fingerprint = 'a'.repeat(64)
const command = () =>
  taskCommand({
    operationId: `${TASK_TEST_NOW}-${'a'.repeat(32)}`,
    requiredCapabilities: ['task.enforcement.v1'],
    executionPolicy: {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'docker-local-linux',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: `docker-enforcement:${'a'.repeat(64)}`
    }
  })
beforeEach(async () => {
  directory = await taskTestDirectory()
  store = await openTestAgentSessionRecordStore(directory)
})
afterEach(async () => {
  vi.restoreAllMocks()
  closeTestJournalHostDatabase(directory)
  await rm(directory, { recursive: true, force: true })
})
async function cancelledDispatch(cancel = true) {
  const start = command()
  await store.tasks.admit({
    command: start,
    ...TASK_TEST_CALLER,
    workspace: taskWorkspace(directory),
    now: TASK_TEST_NOW,
    validate: () => undefined
  })
  await store.tasks.beginDispatch(start, TASK_TEST_NOW, () => undefined)
  await store.admitOperation({
    callerKey: TASK_TEST_CALLER.operationCallerKey,
    operationId: start.operationId,
    fingerprint,
    now: TASK_TEST_NOW
  })
  await store.claimOperation({
    callerKey: TASK_TEST_CALLER.operationCallerKey,
    operationId: start.operationId
  })
  await store.tasks.markUnknown(start, TASK_TEST_NOW)
  if (cancel) {
    await store.tasks.requestCancellation(start, 'cancel:original', TASK_TEST_NOW, () => undefined)
  }
  return start
}
const settle = (
  start = command(),
  validate = () => undefined,
  digest = fingerprint,
  now = TASK_TEST_NOW
) => store.tasks.settleCancelledCodexDispatch(store.tasks.get(start)!, digest, () => now, validate)

const writeState = (state: Awaited<ReturnType<typeof readPersistedTestAgentSessionStore>>) =>
  editPersistedTestAgentSessionStore(directory, (persisted) => Object.assign(persisted, state))

function failWrite(message: string) {
  const database = openTestJournalHostDatabase(directory)
  const original = database.transaction.bind(database)
  vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
    original((db) => {
      run(db)
      throw new Error(message)
    })
  )
}

async function replaceTaskEpoch(start: ReturnType<typeof command>) {
  const original = store.tasks.get(start)!
  const changed = { ...original.command, ownershipEpoch: original.command.ownershipEpoch + 1 }
  const commandFingerprint = computeTaskExecutionFingerprint(changed, original.operationCallerKey)
  const replacement = TaskExecutionRecordSchema.parse({
    ...original,
    command: changed,
    commandFingerprint,
    accepted: { ...original.accepted, ownershipEpoch: changed.ownershipEpoch, commandFingerprint },
    events: original.events.map((event) => ({
      ...event,
      ownershipEpoch: changed.ownershipEpoch,
      commandFingerprint
    }))
  })
  const primary = await readPersistedTestAgentSessionStore(directory)
  primary.taskExecutions[taskExecutionRecordKey(start)] = replacement
  await writeState(primary)
  return commandFingerprint
}

describe('original host cancellation before durable Codex reservation', () => {
  it('settles the original cancelled task without changing dispatch or inventing a launch', async () => {
    const start = await cancelledDispatch()
    await settle(start)
    const record = store.tasks.get(start)!
    expect(record).toMatchObject({
      status: 'cancelled',
      dispatch: 'dispatching',
      cancellationKey: 'cancel:original',
      launch: null,
      result: {
        status: 'cancelled',
        artifactRefs: [],
        stopProof: { evidenceKind: 'not_started', managedToolsSettled: true, writersFenced: true }
      }
    })
    expect(record.structuredBinding).toBeUndefined()
    expect(store.listRecords()).toHaveLength(0)
    expect(store.tasks.listActive()).toHaveLength(0)
    const durable = await openTestAgentSessionRecordStore(directory)
    expect(durable.tasks.get(start)?.result).toEqual(record.result)
    await settle(start)
    expect(store.tasks.get(start)).toEqual(record)
  })
  it('requires durable cancellation rather than unknown or an absent child alone', async () => {
    const start = await cancelledDispatch(false)
    await settle(start)
    expect(store.tasks.get(start)?.result).toBeNull()
  })
  it.each(['fingerprint', 'pending', 'succeeded', 'expired', 'child'])(
    'keeps %s launch evidence unknown',
    async (kind) => {
      const start = await cancelledDispatch()
      if (kind === 'pending' || kind === 'succeeded') {
        await store.recordOperationOutcome({
          callerKey: TASK_TEST_CALLER.operationCallerKey,
          operationId: start.operationId,
          outcome:
            kind === 'pending'
              ? { status: 'pending' }
              : { status: 'succeeded', sessionId: 'original-session' }
        })
      }
      if (kind === 'child') {
        await store.admitOperation({
          callerKey: TASK_TEST_CALLER.operationCallerKey,
          operationId: deriveAgentLaunchChildOperationId(start.operationId)!,
          fingerprint: 'child',
          now: TASK_TEST_NOW
        })
      }
      await settle(
        start,
        () => undefined,
        kind === 'fingerprint' ? 'b'.repeat(64) : fingerprint,
        kind === 'expired' ? TASK_TEST_NOW + 172800000 : TASK_TEST_NOW
      )
      expect(store.tasks.get(start)?.result).toBeNull()
    }
  )
  it('does not accept a revoked authority callback', async () => {
    const start = await cancelledDispatch()
    await expect(
      settle(start, () => {
        throw new Error('FORBIDDEN')
      })
    ).rejects.toThrow('FORBIDDEN')
    expect(store.tasks.get(start)?.result).toBeNull()
  })
  it('refreshes the original ledger under the store lock before issuing proof', async () => {
    const start = await cancelledDispatch()
    const writer = await openTestAgentSessionRecordStore(directory)
    await writer.admitOperation({
      callerKey: TASK_TEST_CALLER.operationCallerKey,
      operationId: deriveAgentLaunchChildOperationId(start.operationId)!,
      fingerprint: 'child',
      now: TASK_TEST_NOW
    })
    await settle(start)
    expect(store.tasks.get(start)?.result).toBeNull()
  })
  it('does not settle a valid replacement Task using the original authorized snapshot', async () => {
    const start = await cancelledDispatch()
    const commandFingerprint = await replaceTaskEpoch(start)
    await settle(start).catch(() => undefined)
    const durable = (await openTestAgentSessionRecordStore(directory)).tasks.get(start)!
    expect(durable.commandFingerprint).toBe(commandFingerprint)
    expect(durable.result).toBeNull()
  })
  it.each([false, true])(
    'does not erase a previously observed reservation/effect after valid primary loss (model=%s)',
    async (model) => {
      const start = await cancelledDispatch()
      const original = store.tasks.get(start)!
      const childId = deriveAgentLaunchChildOperationId(start.operationId)!
      await store.admitOperation({
        callerKey: TASK_TEST_CALLER.operationCallerKey,
        operationId: childId,
        fingerprint: 'child',
        now: TASK_TEST_NOW
      })
      const binding = TaskStructuredBindingSchema.parse({
        source: taskSessionSourceReference(original),
        operationCallerKey: original.operationCallerKey,
        operationId: start.operationId,
        launchFingerprint: fingerprint,
        attachOperationId: childId,
        attachFingerprint: 'b'.repeat(64),
        sessionId: 'synthetic-known-session',
        runtimeFence: 1,
        spawnToken: 'synthetic:known-spawn',
        accountHome: { variable: 'CODEX_HOME', path: directory },
        location: {
          executionHostId: 'local',
          workspaceId: original.workspace.workspaceId,
          workspaceKind: 'folder',
          wslDistro: null
        }
      })
      // The isolated original store fixture records known reservation facts; it never launches a provider.
      const known = TaskExecutionRecordSchema.parse({
        ...original,
        structuredBinding: binding,
        ...(model ? { modelDispatchAttempts: 1 } : {})
      })
      const primary = await readPersistedTestAgentSessionStore(directory)
      primary.taskExecutions[taskExecutionRecordKey(start)] = known
      await writeState(primary)
      store = await openTestAgentSessionRecordStore(directory)
      const expected = store.tasks.get(start)!
      const missing = await readPersistedTestAgentSessionStore(directory)
      delete missing.taskExecutions[taskExecutionRecordKey(start)].structuredBinding
      delete missing.taskExecutions[taskExecutionRecordKey(start)].modelDispatchAttempts
      delete missing.operations[
        agentSessionOperationKey(TASK_TEST_CALLER.operationCallerKey, childId)
      ]
      expect(
        TaskExecutionRecordSchema.safeParse(missing.taskExecutions[taskExecutionRecordKey(start)])
          .success
      ).toBe(true)
      await writeState(missing)
      await store.tasks.settleCancelledCodexDispatch(
        expected,
        fingerprint,
        () => TASK_TEST_NOW,
        () => undefined
      )
      expect((await openTestAgentSessionRecordStore(directory)).tasks.get(start)?.result).toBeNull()
    }
  )
  it('does not refresh away the authorized snapshot after a collector observes another writer', async () => {
    const start = await cancelledDispatch()
    const proof = vi.fn(async () => undefined)
    const host = new TaskExecutionHost({
      store: store.tasks,
      now: () => TASK_TEST_NOW,
      capabilities: () => taskCapabilities(start),
      authorizeEnforcement: async () => undefined,
      authorize: async () => ({
        workspace: taskWorkspace(directory),
        input: 'original private input',
        assertCurrent: () => undefined
      }),
      launch: async () => {
        throw new Error('unreachable')
      },
      collect: async () => null,
      stop: async () => {
        await replaceTaskEpoch(start)
        return null
      },
      settleCancelledDispatch: proof
    })
    const record = store.tasks.get(start)!
    const query = {
      ...Object.fromEntries(
        [
          'protocolVersion',
          'runtimeRecordId',
          'ownershipEpoch',
          'executionId',
          'executionEpoch',
          'authorizationRef',
          'authorizationRevision',
          'expiresAt'
        ].map((key) => [key, start[key]])
      ),
      kind: 'execution.reconcile',
      commandFingerprint: record.commandFingerprint
    }
    await expect(host.reconcile(query, TASK_TEST_CALLER)).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(proof).not.toHaveBeenCalled()
    expect((await openTestAgentSessionRecordStore(directory)).tasks.get(start)?.result).toBeNull()
  })
  it('never signs not_started after the collector later observes reservation facts that disappear', async () => {
    const start = await cancelledDispatch()
    const original = store.tasks.get(start)!
    const childId = deriveAgentLaunchChildOperationId(start.operationId)!
    const binding = TaskStructuredBindingSchema.parse({
      source: taskSessionSourceReference(original),
      operationCallerKey: original.operationCallerKey,
      operationId: start.operationId,
      launchFingerprint: fingerprint,
      attachOperationId: childId,
      attachFingerprint: 'b'.repeat(64),
      sessionId: 'synthetic-later-session',
      runtimeFence: 1,
      spawnToken: 'synthetic:later-spawn',
      accountHome: { variable: 'CODEX_HOME', path: directory },
      location: {
        executionHostId: 'local',
        workspaceId: original.workspace.workspaceId,
        workspaceKind: 'folder',
        wslDistro: null
      }
    })
    let observed = false
    const proof = vi.fn(async (record, _input, validate) => {
      await store.tasks.settleCancelledCodexDispatch(
        record,
        fingerprint,
        () => TASK_TEST_NOW,
        validate
      )
    })
    const host = new TaskExecutionHost({
      store: store.tasks,
      now: () => TASK_TEST_NOW,
      capabilities: () => taskCapabilities(start),
      authorizeEnforcement: async () => undefined,
      authorize: async () => {
        // The authorized initial snapshot is empty; an original writer publishes reservation before collection.
        const primary = await readPersistedTestAgentSessionStore(directory)
        primary.taskExecutions[taskExecutionRecordKey(start)] = TaskExecutionRecordSchema.parse({
          ...original,
          structuredBinding: binding,
          modelDispatchAttempts: 1
        })
        await writeState(primary)
        await store.tasks.readActive(() => undefined)
        return {
          workspace: taskWorkspace(directory),
          input: 'original private input',
          assertCurrent: () => undefined
        }
      },
      launch: async () => {
        throw new Error('unreachable')
      },
      collect: async () => null,
      stop: async (record) => {
        observed = Boolean(record.structuredBinding && record.modelDispatchAttempts === 1)
        const primary = await readPersistedTestAgentSessionStore(directory)
        delete primary.taskExecutions[taskExecutionRecordKey(start)].structuredBinding
        delete primary.taskExecutions[taskExecutionRecordKey(start)].modelDispatchAttempts
        await writeState(primary)
        return null
      },
      settleCancelledDispatch: proof
    })
    const query = {
      ...Object.fromEntries(
        [
          'protocolVersion',
          'runtimeRecordId',
          'ownershipEpoch',
          'executionId',
          'executionEpoch',
          'authorizationRef',
          'authorizationRevision',
          'expiresAt'
        ].map((key) => [key, start[key]])
      ),
      kind: 'execution.reconcile',
      commandFingerprint: original.commandFingerprint
    }
    await host.reconcile(query, TASK_TEST_CALLER).catch(() => undefined)
    expect(observed).toBe(true)
    expect((await openTestAgentSessionRecordStore(directory)).tasks.get(start)?.result).toBeNull()
    const quarantined = await readPersistedTestAgentSessionStore(directory)
    await writeState({ ...quarantined, taskRecoveryBlocked: false })
    await store.tasks.readActive(() => undefined)
    const rewritten: unknown = await readPersistedTestAgentSessionStore(directory)
    expect(rewritten).toMatchObject({ taskRecoveryBlocked: true })
    await store.tasks.settleCancelledCodexDispatch(
      original,
      fingerprint,
      () => TASK_TEST_NOW,
      () => undefined
    )
    expect((await openTestAgentSessionRecordStore(directory)).tasks.get(start)?.result).toBeNull()
  })
  it.each([false, true])(
    'persists observed effect-loss quarantine before a rejected callback (write failure=%s)',
    async (writeFailure) => {
      const start = await cancelledDispatch()
      const primary = await readPersistedTestAgentSessionStore(directory)
      const original = primary.taskExecutions[taskExecutionRecordKey(start)]
      primary.taskExecutions[taskExecutionRecordKey(start)] = TaskExecutionRecordSchema.parse({
        ...original,
        modelDispatchAttempts: 1,
        structuredBinding: {
          source: taskSessionSourceReference(original),
          operationCallerKey: original.operationCallerKey,
          operationId: start.operationId,
          launchFingerprint: fingerprint,
          attachOperationId: deriveAgentLaunchChildOperationId(start.operationId)!,
          attachFingerprint: 'b'.repeat(64),
          sessionId: 'synthetic-rejected-session',
          runtimeFence: 1,
          spawnToken: 'synthetic:rejected-spawn',
          accountHome: { variable: 'CODEX_HOME', path: directory },
          location: {
            executionHostId: 'local',
            workspaceId: original.workspace.workspaceId,
            workspaceKind: 'folder',
            wslDistro: null
          }
        }
      })
      await writeState(primary)
      store = await openTestAgentSessionRecordStore(directory)
      expect(store.tasks.get(start)?.modelDispatchAttempts).toBe(1)
      const missing = await readPersistedTestAgentSessionStore(directory)
      delete missing.taskExecutions[taskExecutionRecordKey(start)].modelDispatchAttempts
      delete missing.taskExecutions[taskExecutionRecordKey(start)].structuredBinding
      expect(
        TaskExecutionRecordSchema.safeParse(missing.taskExecutions[taskExecutionRecordKey(start)])
          .success
      ).toBe(true)
      await writeState(missing)
      const denied = vi.fn(() => {
        throw new Error('FORBIDDEN')
      })
      if (writeFailure) {
        failWrite('synthetic quarantine write failure')
        await expect(store.tasks.readActive(denied)).rejects.toThrow(
          'synthetic quarantine write failure'
        )
        expect(denied).not.toHaveBeenCalled()
        expect(store.tasks.get(start)?.result).toBeNull()
      }
      await expect(store.tasks.readActive(denied)).rejects.toThrow('FORBIDDEN')
      expect(denied).toHaveBeenCalledOnce()
      const durable: unknown = await readPersistedTestAgentSessionStore(directory)
      expect(durable).toMatchObject({ taskRecoveryBlocked: true })
      store = await openTestAgentSessionRecordStore(directory)
      await settle(start)
      expect(store.tasks.get(start)?.result).toBeNull()
      expect((await openTestAgentSessionRecordStore(directory)).tasks.get(start)?.result).toBeNull()
    }
  )
  it('checks parent expiry with the clock read inside the original store lock', async () => {
    const start = await cancelledDispatch()
    const original = store.tasks.get(start)!
    const parent = store.getOperationRow(TASK_TEST_CALLER.operationCallerKey, start.operationId)!
    let instant = TASK_TEST_NOW
    const database = openTestJournalHostDatabase(directory)
    const originalTransaction = database.transaction.bind(database)
    vi.spyOn(database, 'transaction').mockImplementationOnce((run) =>
      originalTransaction((db) => {
        const result = run(db)
        instant = parent.expiresAt + 1
        return result
      })
    )
    const pending = store.tasks.markUnknown(start, TASK_TEST_NOW)
    const settling = store.tasks.settleCancelledCodexDispatch(
      original,
      fingerprint,
      () => instant,
      () => undefined
    )
    await pending
    await settling
    expect(store.tasks.get(start)?.result).toBeNull()
  })
  it.each(['quarantine', 'unreadable', 'foreignHost'])('refuses %s primary state', async (kind) => {
    const start = await cancelledDispatch()
    const primary = await readPersistedTestAgentSessionStore(directory)
    if (kind === 'unreadable') {
      primary.unusableRecords['unreadable:original'] = { reason: 'recordMalformed', raw: {} }
    }
    if (kind === 'foreignHost') {
      primary.hostId = 'other-host'
    }
    await writeState({
      ...primary,
      ...(kind === 'quarantine' ? { taskRecoveryBlocked: true } : {})
    })
    await settle(start).catch(() => undefined)
    expect(
      (
        await readPersistedTestAgentSessionStore(directory, {
          hostId: kind === 'foreignHost' ? 'other-host' : 'local'
        })
      ).taskExecutions[
        JSON.stringify([start.runtimeRecordId, start.executionId, start.executionEpoch])
      ].result
    ).toBeNull()
  })
  it('rolls back terminal proof if the original durable commit fails', async () => {
    const start = await cancelledDispatch()
    failWrite('synthetic write failure')
    await expect(settle(start)).rejects.toThrow('synthetic write failure')
    expect(store.tasks.get(start)?.result).toBeNull()
    expect((await openTestAgentSessionRecordStore(directory)).tasks.get(start)?.result).toBeNull()
  })
  it('uses the private Codex recovery port only after the original flight finishes', async () => {
    const start = await cancelledDispatch()
    const proof = vi.fn(async (record, _input, validate) => {
      await settle(record.command, validate)
    })
    const host = new TaskExecutionHost({
      store: store.tasks,
      now: () => TASK_TEST_NOW,
      capabilities: () => taskCapabilities(start),
      authorizeEnforcement: async () => undefined,
      authorize: async () => ({
        workspace: taskWorkspace(directory),
        input: 'original private input',
        assertCurrent: () => undefined
      }),
      launch: async () => {
        throw new Error('unreachable')
      },
      collect: async () => null,
      stop: async () => null,
      settleCancelledDispatch: proof
    })
    const record = store.tasks.get(start)!
    const observation = await host.reconcile(
      {
        ...Object.fromEntries(
          [
            'protocolVersion',
            'runtimeRecordId',
            'ownershipEpoch',
            'executionId',
            'executionEpoch',
            'authorizationRef',
            'authorizationRevision',
            'expiresAt'
          ].map((key) => [key, start[key]])
        ),
        kind: 'execution.reconcile',
        commandFingerprint: record.commandFingerprint
      },
      TASK_TEST_CALLER
    )
    expect(proof).toHaveBeenCalledOnce()
    expect(observation.result?.stopProof.evidenceKind).toBe('not_started')
  })
  it('cannot prove not_started while the exact original flight is still outstanding', async () => {
    const start = command()
    let release!: () => void
    let enter!: () => void
    const entered = new Promise<void>((done) => {
      enter = done
    })
    const pending = new Promise<void>((done) => {
      release = done
    })
    const proof = vi.fn(async (record, _input, validate) => {
      await settle(record.command, validate)
    })
    const host = new TaskExecutionHost({
      store: store.tasks,
      evidenceTimeoutMs: 5,
      now: () => TASK_TEST_NOW,
      capabilities: () => taskCapabilities(start),
      authorizeEnforcement: async () => undefined,
      authorize: async () => ({
        workspace: taskWorkspace(directory),
        input: 'original private input',
        assertCurrent: () => undefined
      }),
      launch: async () => {
        await store.admitOperation({
          callerKey: TASK_TEST_CALLER.operationCallerKey,
          operationId: start.operationId,
          fingerprint,
          now: TASK_TEST_NOW
        })
        await store.claimOperation({
          callerKey: TASK_TEST_CALLER.operationCallerKey,
          operationId: start.operationId
        })
        enter()
        await pending
        throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
      },
      collect: async () => null,
      stop: async () => null,
      settleCancelledDispatch: proof
    })
    await host.start(start, TASK_TEST_CALLER)
    await entered
    await store.tasks.requestCancellation(start, 'cancel:original', TASK_TEST_NOW, () => undefined)
    const query = {
      ...Object.fromEntries(
        [
          'protocolVersion',
          'runtimeRecordId',
          'ownershipEpoch',
          'executionId',
          'executionEpoch',
          'authorizationRef',
          'authorizationRevision',
          'expiresAt'
        ].map((key) => [key, start[key]])
      ),
      kind: 'execution.reconcile',
      commandFingerprint: store.tasks.get(start)!.commandFingerprint
    }
    await expect(host.reconcile(query, TASK_TEST_CALLER)).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(store.tasks.get(start)?.result).toBeNull()
    release()
    await host.drain()
    const observation = await host.reconcile(query, TASK_TEST_CALLER)
    expect(observation.result?.stopProof.evidenceKind).toBe('not_started')
  })
  it('persists bounded refusal codes while keeping the launch unknown', async () => {
    const start = command()
    const cause = new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE', {
      cause: new Error('Bearer synthetic-secret https://private.invalid token')
    })
    const host = new TaskExecutionHost({
      store: store.tasks,
      now: () => TASK_TEST_NOW,
      capabilities: () => taskCapabilities(start),
      authorizeEnforcement: async () => undefined,
      authorize: async () => ({
        workspace: taskWorkspace(directory),
        input: 'original private input',
        assertCurrent: () => undefined
      }),
      launch: async () => {
        throw new Error('agent_session_operation_unknown', { cause })
      },
      collect: async () => null,
      stop: async () => null
    })
    await host.start(start, TASK_TEST_CALLER)
    await host.drain()
    const record = (await openTestAgentSessionRecordStore(directory)).tasks.get(start)!
    expect(record.status).toBe('outcome_unknown')
    expect(record.result).toBeNull()
    expect(record.events.at(-1)?.summary).toBe(
      'Task dispatch: agent_session_operation_unknown > TASK_MODEL_AUTH_SCOPE_UNAVAILABLE'
    )
    expect(JSON.stringify(record)).not.toContain('synthetic-secret')
  })
})
