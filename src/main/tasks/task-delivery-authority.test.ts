import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createTaskDeliveryAuthorizer } from './task-delivery-authority'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import type { TaskExecutionAuthorization } from './task-execution-ports'
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

function dispatchAuthorization(authorization: TaskExecutionAuthorization) {
  if (!authorization.dispatch) {
    throw new Error('DISPATCH_AUTHORIZATION_MISSING')
  }
  return authorization.dispatch
}

const refreshGuardSources = ['authorization', 'context'] satisfies ('authorization' | 'context')[]
const refreshRevocations = ['revokeGrant', 'changeAccount'] satisfies (
  | 'revokeGrant'
  | 'changeAccount'
)[]

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
  it('keeps continuing source authority live after the first delivery proof expires', async () => {
    const current = fixture()
    const authorization = await current.authorize(current.caller, current.command, 'start')
    expect(authorization.workspace).toEqual(current.authorization.workspace)
    expect(current.context.request).toHaveBeenCalledWith(
      `/hive/execution-delivery/${current.command.task.spaceId}/${current.command.task.runId}/start`
    )
    current.advance(29_999)
    expect(authorization.assertCurrent).not.toThrow()
    current.advance(1)
    expect(authorization.assertCurrent).not.toThrow()
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
  it('expires dispatch permission while continuing authority still checks live sources', async () => {
    const current = fixture()
    const authorization = await current.authorize(current.caller, current.command, 'start')
    const dispatch = dispatchAuthorization(authorization)
    current.advance(30_000)
    expect(authorization.assertCurrent).not.toThrow()
    expect(dispatch.assertCurrent).toThrow('FORBIDDEN')
    current.revokeGrant()
    expect(authorization.assertCurrent).toThrow()
  })
  it('refreshes only the same current DB lease before a slow startup resumes', async () => {
    const current = fixture()
    const authorization = await current.authorize(current.caller, current.command, 'start')
    const dispatch = dispatchAuthorization(authorization)
    current.advance(31_000)
    expect(dispatch.assertCurrent).toThrow('FORBIDDEN')
    current.setResponse({
      ...current.proof,
      serverNow: new Date(TASK_TEST_NOW + 31_000).toISOString(),
      expiresAt: new Date(TASK_TEST_NOW + 61_000).toISOString()
    })
    await expect(dispatch.prepare()).resolves.toBeUndefined()
    expect(dispatch.assertCurrent).not.toThrow()
    expect(current.context.request).toHaveBeenCalledTimes(2)
    current.advance(30_000)
    expect(dispatch.assertCurrent).toThrow('FORBIDDEN')
    expect(authorization.assertCurrent).not.toThrow()
  })
  it('shares one private refresh flight and refuses dispatch while its proof is pending', async () => {
    const current = fixture()
    const authorization = await current.authorize(current.caller, current.command, 'start')
    const dispatch = dispatchAuthorization(authorization)
    let release: () => void = () => undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    current.context.request.mockImplementationOnce(async () => {
      await pending
      return current.proof
    })
    const first = dispatch.prepare()
    const second = dispatch.prepare()
    expect(second).toBe(first)
    expect(dispatch.assertCurrent).toThrow('FORBIDDEN')
    release()
    await Promise.all([first, second])
    expect(current.context.request).toHaveBeenCalledTimes(2)
    expect(dispatch.assertCurrent).not.toThrow()
  })
  it('counts a refresh response delay against the refreshed proof lifetime', async () => {
    const current = fixture()
    const dispatch = dispatchAuthorization(
      await current.authorize(current.caller, current.command, 'start')
    )
    current.advance(20_000)
    current.context.request.mockImplementationOnce(async () => {
      current.advance(15_000)
      return {
        ...current.proof,
        serverNow: new Date(TASK_TEST_NOW + 20_000).toISOString(),
        expiresAt: new Date(TASK_TEST_NOW + 50_000).toISOString()
      }
    })
    await dispatch.prepare()
    current.advance(14_999)
    expect(dispatch.assertCurrent).not.toThrow()
    current.advance(1)
    expect(dispatch.assertCurrent).toThrow('FORBIDDEN')
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
  ])('cannot refresh startup with a replacement identity %j', async (patch) => {
    const current = fixture()
    const authorization = await current.authorize(current.caller, current.command, 'start')
    const dispatch = dispatchAuthorization(authorization)
    current.setResponse({ ...current.proof, ...patch })
    await expect(dispatch.prepare()).rejects.toThrow('FORBIDDEN')
    const effect = vi.fn()
    expect(() => {
      dispatch.assertCurrent()
      effect()
    }).toThrow('FORBIDDEN')
    expect(effect).not.toHaveBeenCalled()
    expect(authorization.assertCurrent).not.toThrow()
  })
  it.each([0, -1, 60_001])('cannot refresh an invalid %i ms lease', async (remaining) => {
    const current = fixture()
    const dispatch = dispatchAuthorization(
      await current.authorize(current.caller, current.command, 'start')
    )
    current.setResponse({
      ...current.proof,
      expiresAt: new Date(TASK_TEST_NOW + remaining).toISOString()
    })
    await expect(dispatch.prepare()).rejects.toThrow('FORBIDDEN')
    expect(dispatch.assertCurrent).toThrow('FORBIDDEN')
  })
  it.each([null, {}, { secret: 'untrusted-body' }])(
    'cannot reuse the old proof after a malformed refresh %j',
    async (response) => {
      const current = fixture()
      const dispatch = dispatchAuthorization(
        await current.authorize(current.caller, current.command, 'start')
      )
      current.setResponse(response)
      await expect(dispatch.prepare()).rejects.toThrow('OUTCOME_UNKNOWN')
      expect(dispatch.assertCurrent).toThrow('FORBIDDEN')
    }
  )
  it('does not retain startup permission after a failed private refresh', async () => {
    const current = fixture()
    const dispatch = dispatchAuthorization(
      await current.authorize(current.caller, current.command, 'start')
    )
    current.context.request.mockRejectedValueOnce(new Error('PRIVATE_ENDPOINT_UNAVAILABLE'))
    await expect(dispatch.prepare()).rejects.toThrow('PRIVATE_ENDPOINT_UNAVAILABLE')
    expect(dispatch.assertCurrent).toThrow('FORBIDDEN')
  })
  it.each(refreshGuardSources)(
    'rechecks strict %s before and after awaiting a refresh',
    async (source) => {
      const current = fixture()
      const dispatch = dispatchAuthorization(
        await current.authorize(current.caller, current.command, 'start')
      )
      current.context.request.mockImplementationOnce(async () => {
        current[source].assertCurrent = () => Promise.resolve()
        return current.proof
      })
      await expect(dispatch.prepare()).rejects.toThrow('FORBIDDEN')
      expect(dispatch.assertCurrent).toThrow('FORBIDDEN')
    }
  )
  it.each(refreshGuardSources)(
    'refuses an async %s guard without another private request',
    async (source) => {
      const current = fixture()
      const dispatch = dispatchAuthorization(
        await current.authorize(current.caller, current.command, 'start')
      )
      current[source].assertCurrent = () => Promise.resolve()
      await expect(dispatch.prepare()).rejects.toThrow('FORBIDDEN')
      expect(current.context.request).toHaveBeenCalledTimes(1)
    }
  )
  it.each(refreshRevocations)(
    'refuses %s during the private response without authorizing an effect',
    async (revoke) => {
      const current = fixture()
      const dispatch = dispatchAuthorization(
        await current.authorize(current.caller, current.command, 'start')
      )
      current.context.request.mockImplementationOnce(async () => {
        current[revoke]()
        return current.proof
      })
      await expect(dispatch.prepare()).rejects.toThrow()
      const effect = vi.fn()
      expect(() => {
        dispatch.assertCurrent()
        effect()
      }).toThrow()
      expect(effect).not.toHaveBeenCalled()
    }
  )
})
