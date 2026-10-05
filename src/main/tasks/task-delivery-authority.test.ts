import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createTaskDeliveryAuthorizer } from './task-delivery-authority'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import {
  taskCommand,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

function fixture() {
  const command = taskCommand({
    task: {
      spaceId: randomUUID(),
      taskId: randomUUID(),
      runId: randomUUID(),
      attempt: 1,
      taskRevision: '0'
    }
  })
  const token = {
    ownerId: 'gateway:delivery-tests',
    leaseRef: 'lease:delivery-tests',
    generation: 1
  }
  const caller = { ...TASK_TEST_CALLER, delivery: token }
  const proof = {
    ...token,
    accountId: 'account:delivery-tests',
    companyId: command.task.spaceId,
    taskId: command.task.taskId,
    runId: command.task.runId,
    protocolVersion: command.protocolVersion,
    runtimeRecordId: command.runtimeRecordId,
    ownershipEpoch: command.ownershipEpoch,
    executionId: command.executionId,
    executionEpoch: command.executionEpoch,
    commandFingerprint: computeTaskExecutionFingerprint(command, caller.operationCallerKey),
    operationId: command.operationId,
    workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
    writeFence: command.writeFence,
    cursor: 0,
    serverNow: new Date(TASK_TEST_NOW).toISOString(),
    expiresAt: new Date(TASK_TEST_NOW + 30_000).toISOString()
  }
  let response: unknown = proof
  let tick = 1000,
    baseCurrent = true,
    accountCurrent = true
  const authorization = {
    workspace: taskWorkspace('/delivery-tests'),
    input: 'Private task input.',
    assertCurrent() {
      if (!baseCurrent) {
        throw new Error('grant revoked')
      }
    }
  }
  const context = {
    accountId: proof.accountId,
    accountRef: 'account:opaque-delivery-tests',
    assertCurrent() {
      if (!accountCurrent) {
        throw new Error('account changed')
      }
    },
    request: vi.fn(async () => response)
  }
  const authorize = createTaskDeliveryAuthorizer({
    authorize: vi.fn(async () => authorization),
    context: async () => context,
    monotonicNow: () => tick
  })
  return {
    command,
    caller,
    proof,
    context,
    authorization,
    authorize,
    setResponse(value: unknown) {
      response = value
    },
    advance(ms: number) {
      tick += ms
    },
    revokeGrant() {
      baseCurrent = false
    },
    changeAccount() {
      accountCurrent = false
    }
  }
}

describe('private persisted delivery authority', () => {
  it.each(['authorization', 'context'] as const)(
    'refuses an asynchronous original %s guard before requesting delivery proof',
    async (source) => {
      const current = fixture()
      current[source].assertCurrent = () => Promise.resolve()
      await expect(current.authorize(current.caller, current.command, 'start')).rejects.toThrow(
        'FORBIDDEN'
      )
      expect(current.context.request).not.toHaveBeenCalled()
    }
  )
  it.each(['authorization', 'context'] as const)(
    'refuses an original %s guard that becomes asynchronous after admission',
    async (source) => {
      const current = fixture()
      const authorization = await current.authorize(current.caller, current.command, 'start')
      current[source].assertCurrent = () => Promise.resolve()
      expect(authorization.assertCurrent).toThrow('FORBIDDEN')
    }
  )
  it('refuses an asynchronous original grant for recovered read-only actions', async () => {
    const current = fixture()
    current.authorization.assertCurrent = () => Promise.resolve()
    await expect(current.authorize(TASK_TEST_CALLER, current.command, 'observe')).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(current.context.request).not.toHaveBeenCalled()
  })
  it('requires both canonical Runtime authorization and the exact current DB delivery', async () => {
    const current = fixture()
    const authorization = await current.authorize(current.caller, current.command, 'start')
    expect(authorization.workspace).toEqual(current.authorization.workspace)
    expect(current.context.request).toHaveBeenCalledWith(
      `/hive/execution-delivery/${current.command.task.spaceId}/${current.command.task.runId}`
    )
    current.advance(29_999)
    expect(authorization.assertCurrent).not.toThrow()
    current.advance(1)
    expect(authorization.assertCurrent).toThrow('FORBIDDEN')
  })
  it('refuses unproved caller headers before reading any DB facts', async () => {
    const current = fixture()
    await expect(current.authorize(TASK_TEST_CALLER, current.command, 'start')).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(current.context.request).not.toHaveBeenCalled()
  })
  it.each([
    { generation: 2 },
    { ownerId: 'gateway:foreign' },
    { leaseRef: 'lease:foreign' },
    { accountId: 'account:foreign' },
    { companyId: randomUUID() },
    { taskId: randomUUID() },
    { runId: randomUUID() },
    { runtimeRecordId: 'runtime:foreign' },
    { ownershipEpoch: 2 },
    { executionId: 'execution:foreign' },
    { executionEpoch: 2 },
    { operationId: 'operation:foreign' },
    { workspaceExecutionClaimRef: 'claim:foreign' },
    { writeFence: 2 },
    { commandFingerprint: 'a'.repeat(64) }
  ])('rejects a substituted delivery proof %j', async (patch) => {
    const current = fixture()
    current.setResponse({ ...current.proof, ...patch })
    await expect(current.authorize(current.caller, current.command, 'start')).rejects.toThrow(
      'FORBIDDEN'
    )
  })
  it.each([0, -1, 60_001])('refuses a DB lease lifetime of %i ms', async (remaining) => {
    const current = fixture()
    current.setResponse({
      ...current.proof,
      expiresAt: new Date(TASK_TEST_NOW + remaining).toISOString()
    })
    await expect(current.authorize(current.caller, current.command, 'start')).rejects.toThrow(
      'FORBIDDEN'
    )
  })
  it('counts a held HTTP response against the granted lease lifetime', async () => {
    const current = fixture()
    current.context.request.mockImplementationOnce(async () => {
      current.advance(30_000)
      return current.proof
    })
    await expect(current.authorize(current.caller, current.command, 'start')).rejects.toThrow(
      'FORBIDDEN'
    )
  })
  it.each(['revokeGrant', 'changeAccount'] as const)(
    'rechecks %s at the final dispatch guard',
    async (revoke) => {
      const current = fixture()
      const authorization = await current.authorize(current.caller, current.command, 'start')
      current[revoke]()
      expect(authorization.assertCurrent).toThrow()
    }
  )
  it.each([null, {}, { secret: 'untrusted-body' }])(
    'retains unavailable or malformed proof as unknown: %j',
    async (response) => {
      const current = fixture()
      current.setResponse(response)
      await expect(current.authorize(current.caller, current.command, 'start')).rejects.toThrow(
        'OUTCOME_UNKNOWN'
      )
    }
  )
  it('leaves a read-only recovered grant independent of a start delivery lease', async () => {
    const current = fixture()
    expect(await current.authorize(TASK_TEST_CALLER, current.command, 'observe')).toBe(
      current.authorization
    )
    expect(current.context.request).not.toHaveBeenCalled()
  })
})
