import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import { taskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { createLocalTaskAuthorizer } from './local-task-authority'
import { createTaskDeliveryAuthorizer } from './task-delivery-authority'
import { TaskExecutionHost } from './task-execution-host'
import type { TaskExecutionHostDependencies } from './task-execution-ports'
import { taskStructuredFixture } from './task-structured-reservation.test-fixture'
import {
  taskCapabilities,
  taskTestDirectory,
  taskWorkspace,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

const roots: string[] = []
afterEach(async () => {
  closeTestJournalHostDatabases()
  for (const directory of roots.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture(where: 'local-grant' | 'inner-authorization' | 'context' | 'valid') {
  const directory = await taskTestDirectory()
  roots.push(directory)
  const f = taskStructuredFixture(taskWorkspace(directory))
  const command = {
    ...f.command,
    task: { ...f.command.task, spaceId: randomUUID(), taskId: randomUUID(), runId: randomUUID() }
  }
  const store = await openTestAgentSessionRecordStore(directory)
  const pending = Promise.withResolvers<void>()
  void pending.promise.catch(() => undefined)
  const guard = vi.fn(() => pending.promise)
  const account = {
    accountId: 'account:authority-admission-test',
    authorityId: 'authority:authority-admission-test',
    sessionGeneration: 1,
    sessionExpiresAt: TASK_TEST_NOW + 120_000,
    accessToken: 'test-only-unused-token'
  }
  const token = {
    ownerId: 'gateway:authority-admission-test',
    leaseRef: 'lease:authority-admission-test',
    generation: 1
  }
  const caller = { operationCallerKey: f.origin.operationCallerKey, delivery: token }
  const grant = {
    command,
    ...caller,
    workspace: taskWorkspace(directory),
    input: 'Offline authority fixture.',
    accountId: account.accountId,
    authorityId: account.authorityId,
    sessionGeneration: account.sessionGeneration,
    runtimeOwnershipEpoch: command.ownershipEpoch,
    validUntil: TASK_TEST_NOW + 120_000,
    actions: ['start', 'observe', 'cancel', 'reconcile'] as const,
    assertCurrent: where === 'local-grant' ? guard : () => undefined
  }
  const local = createLocalTaskAuthorizer({
    currentAccount: () => account,
    currentRuntime: () => ({
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      accountId: account.accountId
    }),
    resolveGrant: (ref) => (ref === command.authorizationRef ? grant : null),
    now: () => TASK_TEST_NOW
  })
  const context = {
    accountId: account.accountId,
    accountRef: 'account:opaque-authority-admission-test',
    assertCurrent: where === 'context' ? guard : () => undefined,
    request: vi.fn(async () => ({
      ...token,
      accountId: account.accountId,
      companyId: command.task.spaceId,
      taskId: command.task.taskId,
      runId: command.task.runId,
      protocolVersion: command.protocolVersion,
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      executionId: command.executionId,
      executionEpoch: command.executionEpoch,
      operationId: command.operationId,
      workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
      writeFence: command.writeFence,
      commandFingerprint: computeTaskExecutionFingerprint(command, caller.operationCallerKey),
      cursor: 0,
      serverNow: new Date(TASK_TEST_NOW).toISOString(),
      expiresAt: new Date(TASK_TEST_NOW + 30_000).toISOString()
    }))
  }
  const authorize = createTaskDeliveryAuthorizer({
    authorize:
      where === 'inner-authorization'
        ? async (...args) => ({ ...(await local(...args)), assertCurrent: guard })
        : local,
    context: async () => context,
    monotonicNow: () => 1000
  })
  const launch = vi.fn<TaskExecutionHostDependencies['launch']>(async (record, authorization) => {
    const origin = {
      ...f.origin,
      source: taskSessionSourceReference(record),
      validate: authorization.assertCurrent
    }
    await store.admitOperation({
      callerKey: origin.operationCallerKey,
      operationId: origin.operationId,
      fingerprint: origin.launchFingerprint,
      now: TASK_TEST_NOW
    })
    await store.claimOperation({
      callerKey: origin.operationCallerKey,
      operationId: origin.operationId
    })
    const request = { ...f.request, taskOrigin: origin }
    const reserved = await store.reserveOwner(request)
    await store.assertTaskAcquisition(request, reserved.record)
    return {
      worktreeId: record.workspace.workspaceId,
      outcome: {
        kind: 'structured',
        sessionId: reserved.record.sessionId,
        handle: 'offline-fixture-handle',
        fence: reserved.record.lease.runtimeFence
      },
      receipt: {
        mode: 'structured',
        preferred: 'structured',
        reason: 'user_default',
        detail: 'Offline fixture; no provider child.'
      }
    }
  })
  const host = new TaskExecutionHost({
    store: store.tasks,
    capabilities: () => taskCapabilities(command),
    now: () => TASK_TEST_NOW,
    authorize,
    launch,
    collect: async () => null,
    stop: async () => null
  })
  return {
    directory,
    store,
    command,
    caller,
    pending,
    guard,
    context,
    launch,
    host,
    sessionId: f.request.sessionId
  }
}

describe('original authorization before Task and Session writes', () => {
  it.each(['local-grant', 'inner-authorization', 'context'] as const)(
    'does not admit or bind a Task while its original %s guard is pending',
    async (where) => {
      const f = await fixture(where)
      try {
        await expect(f.host.start(f.command, f.caller)).rejects.toThrow('FORBIDDEN')
        await f.host.drain()
        expect(f.guard).toHaveBeenCalled()
        expect(f.context.request).not.toHaveBeenCalled()
        expect(f.launch).not.toHaveBeenCalled()
        expect(f.store.tasks.get(f.command)).toBeNull()
        expect(f.store.listRecords()).toHaveLength(0)
        const cold = await openTestAgentSessionRecordStore(f.directory)
        expect(cold.tasks.get(f.command)).toBeNull()
        expect(cold.listRecords()).toHaveLength(0)
        f.pending.reject(new Error('late-original-denial'))
        await expect(f.pending.promise).rejects.toThrow('late-original-denial')
      } finally {
        await f.host.drain()
      }
    }
  )
  it('retains the original atomic binding for synchronous authenticated fixture guards', async () => {
    const f = await fixture('valid')
    try {
      await f.host.start(f.command, f.caller)
      await f.host.drain()
      expect(f.context.request).toHaveBeenCalledOnce()
      expect(f.launch).toHaveBeenCalledOnce()
      const cold = await openTestAgentSessionRecordStore(f.directory)
      const task = cold.tasks.get(f.command)
      expect(task?.dispatch).toBe('bound')
      expect(task?.revision).toBe(4)
      expect(task?.structuredBinding).toBeDefined()
      expect(cold.getRecord(f.sessionId)?.taskSource).toEqual(task?.structuredBinding?.source)
    } finally {
      await f.host.drain()
    }
  })
})
