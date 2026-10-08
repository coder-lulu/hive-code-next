import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServerAdapter } from './paperclip-runtime-adapter'
import { taskAdapterFixture } from './task-adapter.test-fixture'
import { taskStopEvidence } from './task-execution.test-fixture'
import { LocalTaskClient } from './local-task-client'

let fixture: Awaited<ReturnType<typeof taskAdapterFixture>> | undefined
afterEach(async () => {
  await fixture?.close()
  fixture = undefined
})

describe('original host settlement over real HTTP', () => {
  it('waits for positive stop evidence beyond the ordinary request timeout without cancelling success', async () => {
    fixture = await taskAdapterFixture()
    fixture.deps.evidenceTimeoutMs = 30_000
    fixture.ports.waitTimeoutMs = 25_000
    fixture.deps.collect = vi.fn(async () => ({
      outcomeRef: 'outcome:slow-stop',
      artifactRefs: []
    }))
    fixture.deps.stop = vi.fn(async (record) => {
      await delay(11_000)
      return taskStopEvidence(record)
    })
    const cancel = vi.spyOn(fixture.client, 'cancel')
    const result = await createServerAdapter(async () => fixture!.ports).execute(fixture.context)
    expect(result.exitCode).toBe(0)
    expect(fixture.store.tasks.get(fixture.binding.command)?.result?.status).toBe('succeeded')
    expect(cancel).not.toHaveBeenCalled()
    expect(fixture.deps.launch).toHaveBeenCalledOnce()
  }, 30_000)

  it('waits for the original cancellation stop proof beyond the ordinary request timeout', async () => {
    fixture = await taskAdapterFixture()
    fixture.deps.evidenceTimeoutMs = 30_000
    fixture.deps.stop = vi.fn(async (record) => {
      await delay(11_000)
      return taskStopEvidence(record)
    })
    await fixture.client.start(fixture.binding.command, fixture.binding.commandFingerprint)
    await fixture.host.drain()
    const observation = await fixture.client.cancel({
      ...fixture.query,
      kind: 'execution.cancel',
      task: fixture.binding.command.task,
      idempotencyKey: 'cancel:slow-original',
      reason: 'user_requested'
    })
    expect(observation.result?.status).toBe('cancelled')
    expect(observation.result?.stopProof.managedToolsSettled).toBe(true)
    expect(observation.result?.stopProof.writersFenced).toBe(true)
    expect(fixture.deps.launch).toHaveBeenCalledOnce()
  }, 30_000)

  it('keeps an explicit caller timeout without converting a timeout into a stop proof', async () => {
    fixture = await taskAdapterFixture()
    fixture.deps.stop = vi.fn(async (record) => {
      await delay(300)
      return taskStopEvidence(record)
    })
    await fixture.client.start(fixture.binding.command, fixture.binding.commandFingerprint)
    await fixture.host.drain()
    const client = new LocalTaskClient({
      baseUrl: fixture.transport.baseUrl,
      secret: fixture.credential.secret,
      requestTimeoutMs: 100
    })
    await expect(
      client.cancel({
        ...fixture.query,
        kind: 'execution.cancel',
        task: fixture.binding.command.task,
        idempotencyKey: 'cancel:explicit-timeout',
        reason: 'user_requested'
      })
    ).rejects.toThrow('SERVICE_UNAVAILABLE')
    expect(fixture.store.tasks.get(fixture.binding.command)?.result).toBeNull()
    await fixture.host.drain()
  })
})
