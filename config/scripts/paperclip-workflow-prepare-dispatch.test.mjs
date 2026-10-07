import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskDispatch } from '../../integration/paperclip/service/task-dispatch.mjs'
import { createTaskDispatchRecovery } from '../../integration/paperclip/service/task-dispatch-recovery.mjs'
import { workflowPrepareFixture } from '../../src/main/tasks/local-task-workflow-prepare.test-fixture.ts'
import { LocalTaskClient } from '../../src/main/tasks/local-task-client.ts'

const fixtures = [],
  dispatchers = []
afterEach(async () => {
  await Promise.all(dispatchers.splice(0).map((dispatch) => dispatch.close()))
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
})
async function fixture() {
  const f = await workflowPrepareFixture()
  fixtures.push(f)
  const accountId = f.owner.accountId,
    order = [],
    prepares = []
  let delivery = null
  const proof = (claim) => {
    const c = f.task.binding.command
    delivery = {
      accountId,
      companyId: f.task.company_id,
      taskId: f.refs.taskId,
      runId: f.refs.runId,
      ownerId: claim.ownerId,
      leaseRef: claim.leaseRef,
      generation: claim.expectedGeneration + 1,
      serverNow: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      cursor: 0,
      protocolVersion: c.protocolVersion,
      runtimeRecordId: c.runtimeRecordId,
      ownershipEpoch: c.ownershipEpoch,
      executionId: c.executionId,
      executionEpoch: c.executionEpoch,
      commandFingerprint: f.task.binding.commandFingerprint,
      operationId: c.operationId,
      workspaceExecutionClaimRef: c.workspaceExecutionClaimRef,
      writeFence: c.writeFence
    }
    return delivery
  }
  const repository = {
    read: vi.fn(async () => ({ ...f.task })),
    getCurrentDelivery: vi.fn(async () => delivery),
    claimDelivery: vi.fn(async (_account, _task, _run, claim) => {
      order.push('claim')
      return proof(claim)
    }),
    claimRecoveryDelivery: vi.fn(async (_account, _task, _run, claim) => {
      order.push('recover')
      return proof(claim)
    }),
    claimDispatch: vi.fn(async () => {
      order.push('dispatch')
      f.task.run_status = 'running'
    }),
    unknown: vi.fn(async () => undefined),
    drain: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    renewDelivery: vi.fn(async () => delivery),
    releaseDelivery: vi.fn(async () => undefined),
    consumeObservation: vi.fn(),
    listRecoverableRuns: vi.fn(async () => ({
      items: [{ ...f.task, prepareRefs: f.refs }],
      nextCursor: null
    }))
  }
  const createClient = vi.fn(async (headers) => {
    const client = new LocalTaskClient({
      baseUrl: f.transport.baseUrl,
      secret: f.credential.secret,
      headers
    })
    const original = client.prepareCaseRun.bind(client)
    prepares.push(
      vi.spyOn(client, 'prepareCaseRun').mockImplementation(async (refs) => {
        order.push('prepare')
        const result = await original(refs)
        order.push('bound')
        return result
      })
    )
    return client
  })
  const execute = vi.fn(async (resolve) => {
    const ports = await resolve()
    await ports.resolveBinding(f.task.company_id, f.refs.runId, 'execute')
    order.push('execute')
    // This unit adapter proves control ordering only, without launching a Provider.
    Object.assign(f.task, {
      result_receipt: { unit: 'terminal metadata' },
      run_status: 'succeeded'
    })
  })
  const recover = vi.fn(async () => undefined)
  const dispatch = createTaskDispatch(repository, {
    createClient,
    createAdapter: (resolve) => ({
      execute: () => execute(resolve),
      recover: () => recover(resolve)
    })
  })
  dispatchers.push(dispatch)
  return { ...f, accountId, repository, createClient, order, prepares, execute, recover, dispatch }
}

describe('original per-run dispatch flight after private Main preparation', () => {
  it('coalesces concurrent null-binding starts through actual Main HTTP and issuer, then dispatches once without recursion', async () => {
    const f = await fixture()
    await Promise.all([
      f.dispatch.start(f.accountId, f.refs.taskId, f.refs.runId),
      f.dispatch.start(f.accountId, f.refs.taskId, f.refs.runId)
    ])
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
    expect(f.issue).toHaveBeenCalledOnce()
    expect(f.bindingCommit).toHaveBeenCalledOnce()
    expect(f.repository.claimDispatch).toHaveBeenCalledOnce()
    await vi.waitFor(() =>
      expect(f.order).toEqual(['prepare', 'bound', 'claim', 'dispatch', 'execute'])
    )
    expect(f.requests.some(({ path }) => path.endsWith('/dispatch'))).toBe(false)
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('prepares only original unbound committed Case rows from the existing account-scoped recovery scanner', async () => {
    const f = await fixture()
    await f.dispatch.recover()
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
    expect(f.repository.listRecoverableRuns).toHaveBeenCalledWith(f.accountId, {
      after: undefined,
      limit: 32
    })
    expect(f.repository.claimRecoveryDelivery).not.toHaveBeenCalled()
    expect(f.repository.claimDispatch).toHaveBeenCalledOnce()
  })
  it('resumes an original prepared Case after the service restarts before the first delivery', async () => {
    const f = await fixture()
    await f.client.prepareCaseRun(f.refs)
    await f.dispatch.recover()
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(f.order).toEqual(['claim', 'dispatch', 'execute']))
    expect(f.issue).toHaveBeenCalledOnce()
    expect(f.repository.claimDispatch).toHaveBeenCalledOnce()
    expect(f.repository.claimRecoveryDelivery).not.toHaveBeenCalled()
  })
  it('requires the original live start grant before claiming a prepared but undelivered Case', async () => {
    const f = await fixture()
    await f.client.prepareCaseRun(f.refs)
    await f.issuer.close()
    await f.dispatch.recover()
    expect(f.issue).toHaveBeenCalledOnce()
    expect(f.execute).not.toHaveBeenCalled()
    expect(f.repository.claimDelivery).not.toHaveBeenCalled()
    expect(f.repository.claimDispatch).not.toHaveBeenCalled()
  })
  it('resumes the committed admission after a lost preparation ACK without issuing again', async () => {
    const f = await fixture()
    const original = f.createClient.getMockImplementation()
    f.createClient.mockImplementationOnce(async (...args) => {
      const client = await original(...args)
      const prepare = client.prepareCaseRun.bind(client)
      client.prepareCaseRun = async (refs) => {
        await prepare(refs)
        throw new Error('Lost ACK after durable binding')
      }
      return client
    })
    await expect(f.dispatch.start(f.accountId, f.refs.taskId, f.refs.runId)).rejects.toThrow(
      'Lost ACK'
    )
    expect(f.task.binding).not.toBeNull()
    await f.dispatch.recover()
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce())
    expect(f.issue).toHaveBeenCalledOnce()
    expect(f.bindingCommit).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(f.order.at(-1)).toBe('execute'))
  })
  it('refuses a foreign current Runtime account before private preparation', async () => {
    const f = await fixture()
    f.createClient.mockImplementation(async () => ({
      owner: async () => ({ ...f.owner, accountId: 'foreign' }),
      prepareCaseRun: vi.fn()
    }))
    await expect(f.dispatch.start(f.accountId, f.refs.taskId, f.refs.runId)).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(f.issue).not.toHaveBeenCalled()
    expect(f.repository.claimDelivery).not.toHaveBeenCalled()
  })
  it('rejects an unbound personal run instead of making it a Case admission', async () => {
    const f = await fixture()
    f.task.run_scope = { kind: 'personal' }
    await expect(f.dispatch.start(f.accountId, f.refs.taskId, f.refs.runId)).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(f.issue).not.toHaveBeenCalled()
    expect(f.repository.claimDispatch).not.toHaveBeenCalled()
  })
  it('keeps null-binding cancellation outside the preparation/start path', async () => {
    const f = await fixture()
    f.task.cancel_requested = true
    await expect(f.dispatch.start(f.accountId, f.refs.taskId, f.refs.runId)).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(f.issue).not.toHaveBeenCalled()
    expect(f.repository.claimDispatch).not.toHaveBeenCalled()
  })
  it('fences a Runtime owner change after the completed Main prepare ACK', async () => {
    const f = await fixture()
    f.createClient.mockImplementation(async (headers) => {
      const client = new LocalTaskClient({
        baseUrl: f.transport.baseUrl,
        secret: f.credential.secret,
        headers
      })
      const original = client.prepareCaseRun.bind(client)
      vi.spyOn(client, 'prepareCaseRun').mockImplementation(async (refs) => {
        const value = await original(refs)
        f.revokeOwner()
        return value
      })
      return client
    })
    await expect(f.dispatch.start(f.accountId, f.refs.taskId, f.refs.runId)).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(f.bindingCommit).toHaveBeenCalledOnce()
    expect(f.repository.claimDelivery).not.toHaveBeenCalled()
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('retains a drain latch while Main binding commit is pending, without dispatching after its ACK', async () => {
    const f = await fixture(),
      original = f.bindingCommit.getMockImplementation()
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    f.bindingCommit.mockImplementationOnce(async (binding) => {
      await held
      return original(binding)
    })
    const starting = f.dispatch.start(f.accountId, f.refs.taskId, f.refs.runId)
    await vi.waitFor(() => expect(f.bindingCommit).toHaveBeenCalledOnce())
    await f.dispatch.control(f.accountId, f.refs.taskId, 'drain', {
      companyId: f.task.company_id,
      runId: f.refs.runId
    })
    release()
    await starting
    expect(f.repository.claimDelivery).not.toHaveBeenCalled()
    expect(f.repository.claimDispatch).not.toHaveBeenCalled()
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('keeps the original scanner at four concurrent jobs and skips bound queued jobs', async () => {
    let concurrent = 0,
      maximum = 0,
      release
    const held = new Promise((resolve) => {
      release = resolve
    })
    const start = vi.fn(async () => {
      concurrent += 1
      maximum = Math.max(maximum, concurrent)
      await held
      concurrent -= 1
    })
    const recover = vi.fn(),
      owner = { accountId: 'unit-owner', runtimeRecordId: 'runtime:unit', ownershipEpoch: 1 }
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `task:${i}`,
      run_id: `run:${i}`,
      binding: null,
      prepareRefs: {},
      run_status: 'queued',
      cancel_requested: false
    }))
    const repository = { listRecoverableRuns: vi.fn(async () => ({ items, nextCursor: null })) }
    const scanner = createTaskDispatchRecovery({
      repository,
      createClient: async () => ({ owner: async () => owner }),
      start,
      recover,
      isClosed: () => false
    })
    const checking = scanner.check()
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(4))
    expect(maximum).toBe(4)
    release()
    await checking
    await scanner.close()
    expect(start).toHaveBeenCalledTimes(8)
    expect(recover).not.toHaveBeenCalled()
  })
})
