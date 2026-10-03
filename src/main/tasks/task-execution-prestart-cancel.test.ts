import { rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import { TaskExecutionHost } from './task-execution-host'
import {
  taskCapabilities,
  taskCommand,
  taskStopEvidence,
  taskTestDirectory,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

let directory: string
beforeEach(async () => {
  directory = await taskTestDirectory()
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
async function fixture() {
  const store = await openTestAgentSessionRecordStore(directory)
  const start = taskCommand()
  const launch = vi.fn(async () => TASK_TEST_LAUNCH)
  const authorize = vi.fn(async () => ({
    workspace: taskWorkspace(directory),
    input: 'task',
    assertCurrent: () => undefined
  }))
  const host = new TaskExecutionHost({
    store: store.tasks,
    now: () => TASK_TEST_NOW,
    capabilities: () => taskCapabilities(),
    resolveStart: () => start,
    authorize,
    launch,
    collect: async () => null,
    stop: async (record) => taskStopEvidence(record)
  })
  const command = {
    protocolVersion: 1,
    kind: 'execution.cancel',
    runtimeRecordId: start.runtimeRecordId,
    ownershipEpoch: start.ownershipEpoch,
    executionId: start.executionId,
    executionEpoch: start.executionEpoch,
    commandFingerprint: computeTaskExecutionFingerprint(start, TASK_TEST_CALLER.operationCallerKey),
    authorizationRef: start.authorizationRef,
    authorizationRevision: start.authorizationRevision,
    expiresAt: start.expiresAt,
    task: start.task,
    idempotencyKey: 'cancel:prestart',
    reason: 'user_requested'
  }
  return { store, start, host, launch, authorize, command }
}
describe('cancellation before start', () => {
  it('records not-started proof and prevents a later replay from launching', async () => {
    const { host, launch, command, start } = await fixture()
    const result = await host.cancel(command, TASK_TEST_CALLER)
    expect(result.result?.status).toBe('cancelled')
    expect(result.result?.stopProof.evidenceKind).toBe('not_started')
    await host.start(start, TASK_TEST_CALLER)
    await host.drain()
    expect(launch).not.toHaveBeenCalled()
  })
  it('rejects a foreign execution before creating a record', async () => {
    const { host, authorize, command, store, start } = await fixture()
    await expect(
      host.cancel({ ...command, executionId: 'execution:foreign' }, TASK_TEST_CALLER)
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(authorize).not.toHaveBeenCalled()
    expect(store.tasks.get(start)).toBeNull()
  })
  it('cannot admit a revoked grant while cancelling', async () => {
    const { host, authorize, command, store, start } = await fixture()
    authorize.mockRejectedValue(new Error('FORBIDDEN'))
    await expect(host.cancel(command, TASK_TEST_CALLER)).rejects.toThrow('FORBIDDEN')
    expect(store.tasks.get(start)).toBeNull()
  })
})
