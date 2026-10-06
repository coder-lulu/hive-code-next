import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskDispatch } from '../../integration/paperclip/service/task-dispatch.mjs'
import { createTaskDispatchDelivery } from '../../integration/paperclip/service/task-dispatch-delivery.mjs'
import { createTaskDispatchRecovery } from '../../integration/paperclip/service/task-dispatch-recovery.mjs'
import { taskCommand } from '../../src/main/tasks/task-execution.test-fixture.ts'
import { taskAdapterFixture } from '../../src/main/tasks/task-adapter.test-fixture.ts'
import { LocalTaskClient } from '../../src/main/tasks/local-task-client.ts'

let fixture, dispatch
afterEach(async () => {
  await dispatch?.close()
  await fixture?.close()
  dispatch = fixture = undefined
  vi.useRealTimers()
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((done, failed) => {
    resolve = done
    reject = failed
  })
  return { promise, resolve, reject }
}
async function context() {
  const companyId = randomUUID(),
    agentId = randomUUID(),
    taskId = randomUUID(),
    runId = randomUUID()
  const command = taskCommand({
    profileId: 'codex',
    profileRevision: 'codex:1',
    task: { spaceId: companyId, taskId, runId, attempt: 1, taskRevision: '0' }
  })
  fixture = await taskAdapterFixture({ command, companyId, agentId })
  const runtime = fixture
  const accountId = 'account:durable-dispatch'
  const task = {
    id: taskId,
    company_id: companyId,
    agent_id: agentId,
    run_id: runId,
    driver_kind: 'hive_runtime',
    binding: runtime.binding,
    cancel_requested: false,
    result_receipt: null,
    run_status: 'queued'
  }
  const owner = {
    accountId,
    runtimeRecordId: command.runtimeRecordId,
    ownershipEpoch: command.ownershipEpoch
  }
  let delivery = null
  const order = []
  const proof = (claim) => ({
    ...claim,
    accountId,
    companyId,
    taskId,
    runId,
    cursor: 0,
    generation: claim.expectedGeneration + 1,
    serverNow: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    protocolVersion: command.protocolVersion,
    runtimeRecordId: command.runtimeRecordId,
    ownershipEpoch: command.ownershipEpoch,
    executionId: command.executionId,
    executionEpoch: command.executionEpoch,
    commandFingerprint: runtime.binding.commandFingerprint,
    operationId: command.operationId,
    workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
    writeFence: command.writeFence
  })
  const makeProof = (claim) => {
    const value = proof(claim)
    delete value.expectedGeneration
    delete value.leaseMs
    delivery = value
    return value
  }
  const repository = {
    read: vi.fn(async () => ({ ...task })),
    getCurrentDelivery: vi.fn(async () => delivery),
    claimDelivery: vi.fn(async (_account, _task, _run, claim) => {
      order.push('claim')
      return makeProof(claim)
    }),
    claimRecoveryDelivery: vi.fn(async (_account, _task, _run, claim) => {
      order.push('recovery-claim')
      const { commandFingerprint: _fingerprint, ...input } = claim
      return makeProof(input)
    }),
    claimDispatch: vi.fn(async () => {
      order.push('dispatch')
      task.run_status = 'running'
      return task
    }),
    cancel: vi.fn(async () => {
      task.cancel_requested = true
      return task
    }),
    drain: vi.fn(async () => {
      order.push('drain')
      return task
    }),
    unknown: vi.fn(async () => {}),
    settle: vi.fn(async () => {
      throw new Error('Direct settlement is forbidden')
    }),
    consumeObservation: vi.fn(async (_account, _id, _run, token, observation) => {
      expect(token).toMatchObject({
        ownerId: delivery.ownerId,
        leaseRef: delivery.leaseRef,
        generation: delivery.generation
      })
      if (observation.result && observation.cursor === observation.lastSequence) {
        task.result_receipt = observation.result
      }
      delivery.cursor = observation.cursor
      return { settled: task.result_receipt !== null }
    }),
    releaseDelivery: vi.fn(async () => {
      order.push('release')
      return delivery
    }),
    renewDelivery: vi.fn(async () => delivery),
    listRecoverableRuns: vi.fn(async () => ({ items: [task], nextCursor: null }))
  }
  const clients = []
  const createClient = vi.fn(async (headers) => {
    const client = new LocalTaskClient({
      baseUrl: runtime.transport.baseUrl,
      secret: runtime.credential.secret,
      headers
    })
    vi.spyOn(client, 'owner').mockResolvedValue(owner)
    vi.spyOn(client, 'binding').mockImplementation(async (_company, _run, purpose) => {
      order.push(`binding:${purpose}`)
      return runtime.binding
    })
    clients.push(client)
    return client
  })
  return {
    runtime,
    accountId,
    task,
    owner,
    repository,
    createClient,
    order,
    proof,
    makeProof,
    clients
  }
}

describe('durable dispatch through the real Runtime HTTP event stream', () => {
  it('latches a per-run drain while its initial read is pending and never dispatches it', async () => {
    const current = await context()
    const hold = deferred()
    current.repository.read.mockImplementationOnce(() => hold.promise)
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    expect(dispatch.control).toBeTypeOf('function')
    const starting = dispatch.start(current.accountId, current.task.id, current.task.run_id)
    await dispatch.control(current.accountId, current.task.id, 'drain', {
      companyId: current.task.company_id,
      runId: current.task.run_id
    })
    hold.resolve(current.task)
    await starting
    await dispatch.recover()
    await dispatch.start(current.accountId, current.task.id, current.task.run_id)
    expect(current.repository.claimDelivery).not.toHaveBeenCalled()
    expect(current.repository.claimDispatch).not.toHaveBeenCalled()
    expect(current.runtime.deps.launch).not.toHaveBeenCalled()
    expect(current.repository.cancel).not.toHaveBeenCalled()
  })
  it('keeps a drained observer detached until an explicit recovery of that original run', async () => {
    const current = await context()
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await dispatch.start(current.accountId, current.task.id, current.task.run_id)
    await vi.waitFor(() => expect(current.runtime.deps.launch).toHaveBeenCalledOnce())
    const scope = { companyId: current.task.company_id, runId: current.task.run_id }
    await dispatch.control(current.accountId, current.task.id, 'drain', scope)
    await vi.waitFor(() => expect(current.repository.releaseDelivery).toHaveBeenCalledOnce())
    await dispatch.recover()
    await dispatch.start(current.accountId, current.task.id, current.task.run_id)
    expect(current.repository.claimRecoveryDelivery).not.toHaveBeenCalled()
    expect(current.runtime.deps.stop).not.toHaveBeenCalled()
    await dispatch.control(current.accountId, current.task.id, 'recover', scope)
    await vi.waitFor(() => expect(current.repository.claimRecoveryDelivery).toHaveBeenCalledOnce())
    expect(current.repository.claimDispatch).toHaveBeenCalledOnce()
    expect(current.runtime.deps.launch).toHaveBeenCalledOnce()
    expect(current.runtime.deps.stop).not.toHaveBeenCalled()
  })
  it('delivers cancellation of a drained run without restarting its provider', async () => {
    const current = await context()
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await dispatch.start(current.accountId, current.task.id, current.task.run_id)
    await vi.waitFor(() => expect(current.runtime.deps.launch).toHaveBeenCalledOnce())
    const scope = { companyId: current.task.company_id, runId: current.task.run_id }
    await dispatch.control(current.accountId, current.task.id, 'drain', scope)
    await dispatch.control(current.accountId, current.task.id, 'cancel', scope)
    await vi.waitFor(() => expect(current.task.result_receipt?.status).toBe('cancelled'))
    expect(current.runtime.deps.launch).toHaveBeenCalledOnce()
    expect(current.runtime.deps.stop).toHaveBeenCalledOnce()
    expect(current.repository.claimDispatch).toHaveBeenCalledOnce()
  })
  it('does not start an undispatched queued run through an explicit observer request', async () => {
    const current = await context()
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await dispatch.control(current.accountId, current.task.id, 'recover', {
      companyId: current.task.company_id,
      runId: current.task.run_id
    })
    expect(current.repository.claimDelivery).not.toHaveBeenCalled()
    expect(current.repository.claimRecoveryDelivery).not.toHaveBeenCalled()
    expect(current.repository.claimDispatch).not.toHaveBeenCalled()
    expect(current.runtime.deps.launch).not.toHaveBeenCalled()
  })
  it('refuses stale run identity and arbitrary control actions before any intent or launch', async () => {
    const current = await context()
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    for (const [action, scope] of [
      ['cancel', { companyId: randomUUID(), runId: current.task.run_id }],
      ['drain', { companyId: current.task.company_id, runId: randomUUID() }],
      ['start', { companyId: current.task.company_id, runId: current.task.run_id }]
    ]) {
      await expect(
        dispatch.control(current.accountId, current.task.id, action, scope)
      ).rejects.toThrow('FORBIDDEN')
    }
    expect(current.repository.cancel).not.toHaveBeenCalled()
    expect(current.repository.drain).not.toHaveBeenCalled()
    expect(current.repository.claimDelivery).not.toHaveBeenCalled()
    expect(current.runtime.deps.launch).not.toHaveBeenCalled()
  })
  it('hands delivery off on shutdown while retaining the live Runtime and its original slot', async () => {
    const current = await context()
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await dispatch.start(current.accountId, current.task.id, current.task.run_id)
    await vi.waitFor(() => expect(current.runtime.deps.launch).toHaveBeenCalledOnce())
    await dispatch.close()
    expect(current.repository.cancel).not.toHaveBeenCalled()
    expect(current.runtime.deps.stop).not.toHaveBeenCalled()
    expect(current.task.cancel_requested).toBe(false)
    expect(current.task.result_receipt).toBeNull()
    const retained = await current.runtime.client.observe({
      ...current.runtime.query,
      kind: 'execution.observe',
      afterSequence: 0,
      limit: 32
    })
    expect(retained.result).toBeNull()
    expect(retained.status).toBe('running')
    expect(current.repository.drain).toHaveBeenCalledOnce()
    expect(current.order.indexOf('drain')).toBeLessThan(current.order.indexOf('release'))
  })
  it('does not dispatch a reserved fresh run after shutdown begins during its initial read', async () => {
    const current = await context()
    const hold = deferred()
    current.repository.read.mockImplementationOnce(() => hold.promise)
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    const starting = dispatch.start(current.accountId, current.task.id, current.task.run_id)
    const closing = dispatch.close()
    hold.resolve(current.task)
    await Promise.all([starting, closing])
    expect(current.repository.cancel).not.toHaveBeenCalled()
    expect(current.repository.claimDispatch).not.toHaveBeenCalled()
    expect(current.runtime.deps.launch).not.toHaveBeenCalled()
    expect(current.task.cancel_requested).toBe(false)
    expect(current.task.result_receipt).toBeNull()
    expect(current.repository.drain).toHaveBeenCalled()
  })
  it('claims before launch, carries fenced headers and commits a terminal result through the inbox', async () => {
    const current = await context()
    current.runtime.deps.collect = vi.fn(async () => ({
      outcomeRef: 'outcome:dispatch',
      artifactRefs: []
    }))
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await Promise.all([
      dispatch.start(current.accountId, current.task.id, current.task.run_id),
      dispatch.start(current.accountId, current.task.id, current.task.run_id)
    ])
    await vi.waitFor(() => expect(current.task.result_receipt?.status).toBe('succeeded'))
    await vi.waitFor(() => expect(current.repository.releaseDelivery).toHaveBeenCalledOnce())
    expect(current.repository.claimDelivery).toHaveBeenCalledOnce()
    expect(current.repository.claimDispatch).toHaveBeenCalledWith(
      current.accountId,
      current.task.id,
      current.task.run_id,
      expect.objectContaining({ generation: 1 })
    )
    expect(current.order.indexOf('claim')).toBeLessThan(current.order.indexOf('dispatch'))
    expect(current.order.lastIndexOf('binding:recover')).toBeLessThan(
      current.order.indexOf('release')
    )
    expect(current.runtime.deps.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: expect.objectContaining({ generation: 1 })
      }),
      expect.anything(),
      'start'
    )
    expect(current.runtime.deps.launch).toHaveBeenCalledOnce()
    expect(current.repository.consumeObservation).toHaveBeenCalled()
    expect(current.repository.settle).not.toHaveBeenCalled()
  })
  it('recovers the original committed execution without replaying launch or dispatch', async () => {
    const current = await context()
    await current.runtime.client.start(
      current.runtime.binding.command,
      current.runtime.binding.commandFingerprint
    )
    await current.runtime.host.drain()
    current.runtime.deps.collect = vi.fn(async () => ({
      outcomeRef: 'outcome:retained',
      artifactRefs: []
    }))
    await current.runtime.client.reconcile(current.runtime.query)
    vi.mocked(current.runtime.deps.collect).mockClear()
    current.task.run_status = 'running'
    current.makeProof({
      ownerId: 'gateway:crashed',
      leaseRef: 'lease:crashed',
      expectedGeneration: 0
    })
    current.repository.getCurrentDelivery.mockImplementation(async () => ({
      ...current.proof({
        ownerId: 'gateway:crashed',
        leaseRef: 'lease:crashed',
        expectedGeneration: 0
      }),
      expiresAt: new Date(Date.now() - 1000).toISOString()
    }))
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await dispatch.start(current.accountId, current.task.id, current.task.run_id)
    await vi.waitFor(() => expect(current.task.result_receipt?.status).toBe('succeeded'))
    expect(current.order.indexOf('binding:recover')).toBeLessThan(
      current.order.indexOf('recovery-claim')
    )
    expect(current.repository.claimDelivery).not.toHaveBeenCalled()
    expect(current.repository.claimDispatch).not.toHaveBeenCalled()
    expect(current.runtime.deps.launch).toHaveBeenCalledOnce()
    expect(current.runtime.deps.collect).not.toHaveBeenCalled()
  })
  it('replays the same terminal page after its committed inbox acknowledgement is lost', async () => {
    const current = await context()
    current.runtime.deps.collect = vi.fn(async () => ({
      outcomeRef: 'outcome:lost-ack',
      artifactRefs: []
    }))
    const consume = current.repository.consumeObservation.getMockImplementation()
    current.repository.consumeObservation.mockImplementationOnce(async (...args) => {
      await consume(...args)
      throw new Error('Committed response lost')
    })
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await dispatch.start(current.accountId, current.task.id, current.task.run_id)
    await vi.waitFor(() => expect(current.repository.releaseDelivery).toHaveBeenCalledOnce())
    expect(current.task.result_receipt?.status).toBe('succeeded')
    expect(current.repository.consumeObservation).toHaveBeenCalledTimes(2)
    expect(current.repository.consumeObservation.mock.calls[0][4]).toEqual(
      current.repository.consumeObservation.mock.calls[1][4]
    )
    expect(current.runtime.deps.launch).toHaveBeenCalledOnce()
    expect(current.repository.settle).not.toHaveBeenCalled()
  })
  it('waits for a foreign live DB lease without revoking its grant or invoking an adapter', async () => {
    const current = await context()
    current.makeProof({ ownerId: 'gateway:live', leaseRef: 'lease:live', expectedGeneration: 0 })
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await expect(
      dispatch.start(current.accountId, current.task.id, current.task.run_id)
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(current.order).toEqual([])
    expect(current.repository.claimRecoveryDelivery).not.toHaveBeenCalled()
    expect(current.runtime.deps.launch).not.toHaveBeenCalled()
  })
  it('redelivers persisted cancellation after losing the in-memory flight, without another start', async () => {
    const current = await context()
    await current.runtime.client.start(
      current.runtime.binding.command,
      current.runtime.binding.commandFingerprint
    )
    await current.runtime.host.drain()
    current.task.run_status = 'running'
    current.task.cancel_requested = true
    current.makeProof({
      ownerId: 'gateway:crashed',
      leaseRef: 'lease:crashed',
      expectedGeneration: 0
    })
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await dispatch.cancel(current.accountId, current.task.id, current.task.run_id)
    await vi.waitFor(() => expect(current.task.result_receipt?.status).toBe('cancelled'))
    expect(current.runtime.deps.launch).toHaveBeenCalledOnce()
    expect(current.runtime.deps.stop).toHaveBeenCalledOnce()
    expect(current.repository.claimDispatch).not.toHaveBeenCalled()
  })
  it('refuses a different authenticated Runtime account before a claim or grant handshake', async () => {
    const current = await context()
    current.owner.accountId = 'account:foreign'
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await expect(
      dispatch.start(current.accountId, current.task.id, current.task.run_id)
    ).rejects.toThrow('FORBIDDEN')
    expect(current.order).toEqual([])
    expect(current.runtime.deps.launch).not.toHaveBeenCalled()
  })
  it('does not claim recovery if the Runtime cannot revoke the prior start grant', async () => {
    const current = await context()
    current.task.run_status = 'running'
    current.createClient.mockImplementation(async () => ({
      owner: async () => current.owner,
      binding: async () => {
        throw new Error('Runtime unavailable')
      }
    }))
    dispatch = createTaskDispatch(current.repository, { createClient: current.createClient })
    await expect(
      dispatch.start(current.accountId, current.task.id, current.task.run_id)
    ).rejects.toThrow('Runtime unavailable')
    expect(current.repository.claimRecoveryDelivery).not.toHaveBeenCalled()
    expect(current.repository.claimDispatch).not.toHaveBeenCalled()
  })
})

describe('delivery lifetime and recovery scanner', () => {
  it('stops observation effects after failed renewal without treating lease loss as cancellation', async () => {
    const current = await context()
    let tick = 0,
      captured
    const started = deferred(),
      finish = deferred()
    const proof = current.makeProof({
      ownerId: 'gateway:renewal',
      leaseRef: 'lease:renewal',
      expectedGeneration: 0
    })
    current.repository.renewDelivery.mockRejectedValueOnce(new Error('lease lost'))
    const abort = new AbortController()
    vi.useFakeTimers()
    const delivery = createTaskDispatchDelivery({
      repository: current.repository,
      accountId: current.accountId,
      task: current.task,
      proof,
      client: await current.createClient(),
      abort,
      purpose: 'recover',
      monotonicNow: () => tick,
      requestedAt: tick,
      createAdapter: (resolve) => ({
        recover: async () => {
          captured = await resolve()
          started.resolve()
          await finish.promise
        }
      })
    })
    const run = delivery.run()
    await started.promise
    tick = 10_000
    await vi.advanceTimersByTimeAsync(10_000)
    expect(() => captured.assertCurrent()).toThrow('OUTCOME_UNKNOWN')
    expect(abort.signal.aborted).toBe(false)
    await expect(captured.onObservation({ cursor: 0 })).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(current.repository.consumeObservation).not.toHaveBeenCalled()
    expect(current.runtime.deps.stop).not.toHaveBeenCalled()
    finish.resolve()
    await run
    await delivery.close()
    vi.useRealTimers()
  })
  it('coalesces account-scoped scans and waits for in-flight work when closing', async () => {
    const current = await context()
    current.task.run_status = 'running'
    const hold = deferred()
    const recover = vi.fn(() => hold.promise)
    const scanner = createTaskDispatchRecovery({
      repository: current.repository,
      createClient: current.createClient,
      recover,
      isClosed: () => false
    })
    const first = scanner.check(),
      second = scanner.check()
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce())
    expect(current.repository.listRecoverableRuns).toHaveBeenCalledWith(current.accountId, {
      after: undefined,
      limit: 32
    })
    let closed = false
    const closing = scanner.close().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    hold.resolve()
    await Promise.all([first, second, closing])
    await scanner.check()
    expect(recover).toHaveBeenCalledOnce()
  })
  it('skips new queued tasks and other Runtime records during automatic recovery', async () => {
    const current = await context()
    current.repository.listRecoverableRuns.mockResolvedValue({
      items: [
        current.task,
        {
          ...current.task,
          run_status: 'running',
          binding: {
            ...current.task.binding,
            command: { ...current.task.binding.command, runtimeRecordId: 'runtime:another' }
          }
        }
      ],
      nextCursor: null
    })
    const recover = vi.fn()
    const scanner = createTaskDispatchRecovery({
      repository: current.repository,
      createClient: current.createClient,
      recover,
      isClosed: () => false
    })
    await scanner.check()
    expect(recover).not.toHaveBeenCalled()
    await scanner.close()
  })
  it('arms one periodic recovery timer when startup is requested twice', async () => {
    const current = await context()
    vi.useFakeTimers()
    const scanner = createTaskDispatchRecovery({
      repository: current.repository,
      createClient: current.createClient,
      recover: vi.fn(),
      isClosed: () => false
    })
    scanner.start()
    scanner.start()
    await scanner.check()
    expect(vi.getTimerCount()).toBe(1)
    await scanner.close()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
