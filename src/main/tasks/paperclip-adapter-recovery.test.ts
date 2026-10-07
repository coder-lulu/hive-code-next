import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServerAdapter } from './paperclip-runtime-adapter'
import { taskAdapterFixture } from './task-adapter.test-fixture'
import {
  TaskExecutionObserveSchema,
  TaskExecutionObservationSchema
} from '../../shared/task-execution/task-execution-observation'

let fixture: Awaited<ReturnType<typeof taskAdapterFixture>> | undefined
afterEach(async () => {
  await fixture?.close()
  fixture = undefined
})

describe('external execution recovery', () => {
  it('observes a committed original outcome without collection, start or dispatch effects', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    await current.client.start(current.binding.command, current.binding.commandFingerprint)
    await current.host.drain()
    const start = vi.spyOn(current.client, 'start')
    current.deps.collect = vi.fn(async () => ({
      outcomeRef: 'outcome:recovered',
      artifactRefs: ['artifact:retained']
    }))
    await current.client.reconcile(current.query)
    vi.mocked(current.deps.collect).mockClear()
    const reconcile = vi.spyOn(current.client, 'reconcile')
    const result = await createServerAdapter(async () => current.ports).recover(current.context)
    expect(result.resultJson?.status).toBe('succeeded')
    expect(result.sessionParams?.executionId).toBe(current.binding.command.executionId)
    expect(start).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(current.deps.collect).not.toHaveBeenCalled()
    expect(current.context.onDispatch).not.toHaveBeenCalled()
    expect(current.ports.resolveBinding).toHaveBeenCalledWith(
      current.binding.paperclipCompanyId,
      current.binding.command.task.runId,
      'recover'
    )
    expect(current.deps.launch).toHaveBeenCalledOnce()
  })
  it('keeps a missing original execution unresolved without starting it', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    const start = vi.spyOn(current.client, 'start')
    const result = await createServerAdapter(async () => current.ports).recover(current.context)
    expect(result.errorCode).toBe('OUTCOME_UNKNOWN')
    expect(current.store.tasks.get(current.binding.command)).toBeNull()
    expect(start).not.toHaveBeenCalled()
    expect(current.deps.launch).not.toHaveBeenCalled()
  })
  it('cancels the retained execution after a recovered durable cancellation request', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    await current.client.start(current.binding.command, current.binding.commandFingerprint)
    await current.host.drain()
    current.controller.abort()
    const start = vi.spyOn(current.client, 'start')
    const result = await createServerAdapter(async () => current.ports).recover(current.context)
    expect(result.resultJson?.status).toBe('cancelled')
    expect(current.store.tasks.get(current.binding.command)?.cancellationKey).toBe(
      `cancel:${current.binding.commandFingerprint}`
    )
    expect(current.deps.launch).toHaveBeenCalledOnce()
    expect(current.deps.stop).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })
  it('retains unknown stop evidence and never frees the original execution by timeout', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    await current.client.start(current.binding.command, current.binding.commandFingerprint)
    await current.host.drain()
    current.ports.waitTimeoutMs = 0
    current.deps.stop = vi.fn(async () => null)
    const result = await createServerAdapter(async () => current.ports).recover(current.context)
    expect(result.errorCode).toBe('OUTCOME_UNKNOWN')
    expect(result.sessionParams?.executionId).toBe(current.binding.command.executionId)
    expect(current.store.tasks.get(current.binding.command)?.result).toBeNull()
    expect(current.store.tasks.get(current.binding.command)?.cancellationKey).toBeNull()
    expect(current.deps.stop).not.toHaveBeenCalled()
    expect(current.deps.launch).toHaveBeenCalledOnce()
  })
  it('does not collect or stop a running writer while waiting for recovered observations', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    await current.client.start(current.binding.command, current.binding.commandFingerprint)
    await current.host.drain()
    current.ports.waitTimeoutMs = 40
    const reconcile = vi.spyOn(current.client, 'reconcile')
    const result = await createServerAdapter(async () => current.ports).recover(current.context)
    expect(result.errorCode).toBe('OUTCOME_UNKNOWN')
    expect(reconcile).not.toHaveBeenCalled()
    expect(current.deps.collect).not.toHaveBeenCalled()
    expect(current.deps.stop).not.toHaveBeenCalled()
    expect(current.store.tasks.get(current.binding.command)?.cancellationKey).toBeNull()
  })
  it('waits for all terminal event pages and their durable acknowledgements before returning', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    await current.client.start(current.binding.command, current.binding.commandFingerprint)
    await current.host.drain()
    current.deps.collect = vi.fn(async () => ({ outcomeRef: 'outcome:paged', artifactRefs: [] }))
    const terminal = await current.client.reconcile(current.query)
    const events = Array.from({ length: 35 }, (_, index) => ({
      ...(index === 34 ? terminal.events.at(-1) : terminal.events[0]),
      sequence: index + 1
    }))
    const after: number[] = [],
      consumed: number[] = []
    vi.spyOn(current.client, 'observe').mockImplementation(async (value) => {
      const query = TaskExecutionObserveSchema.parse(value)
      after.push(query.afterSequence)
      const page = events.slice(query.afterSequence, query.afterSequence + query.limit)
      return TaskExecutionObservationSchema.parse({
        ...terminal,
        events: page,
        cursor: page.at(-1)?.sequence ?? query.afterSequence,
        lastSequence: events.length
      })
    })
    let finish!: () => void, reachedTerminal!: () => void
    const hold = new Promise<void>((resolve) => {
      finish = resolve
    })
    const atTerminal = new Promise<void>((resolve) => {
      reachedTerminal = resolve
    })
    current.ports.onObservation = async (observation) => {
      consumed.push(observation.cursor)
      if (observation.cursor === events.length) {
        reachedTerminal()
        await hold
      }
    }
    let returned = false
    const recovery = createServerAdapter(async () => current.ports)
      .recover(current.context)
      .then((result) => {
        returned = true
        return result
      })
    await atTerminal
    expect(returned).toBe(false)
    finish()
    expect((await recovery).resultJson?.status).toBe('succeeded')
    expect(after).toEqual([0, 32])
    expect(consumed).toEqual([32, 35])
    expect(current.deps.launch).toHaveBeenCalledOnce()
  })
})
