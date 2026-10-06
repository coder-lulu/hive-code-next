import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServerAdapter } from './paperclip-runtime-adapter'
import { LocalTaskClient } from './local-task-client'
import { taskAdapterFixture } from './task-adapter.test-fixture'
import { TASK_TEST_LAUNCH } from './task-execution.test-fixture'

let fixture: Awaited<ReturnType<typeof taskAdapterFixture>> | undefined
afterEach(async () => {
  await fixture?.close()
  fixture = undefined
  vi.restoreAllMocks()
})

describe('committed startup observation before launch collection', () => {
  it('does not cancel an acknowledged launch merely because reconciliation exceeds its HTTP deadline', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    const release = Promise.withResolvers<void>()
    const acknowledged = Promise.withResolvers<void>()
    current.deps.launch = vi.fn(async () => {
      await release.promise
      return TASK_TEST_LAUNCH
    })
    current.deps.collect = vi.fn(async () => ({ outcomeRef: 'outcome:test', artifactRefs: [] }))
    const shortClient = new LocalTaskClient({
      baseUrl: current.transport.baseUrl,
      secret: current.credential.secret,
      requestTimeoutMs: 100
    })
    vi.spyOn(current.client, 'reconcile').mockImplementation(
      shortClient.reconcile.bind(shortClient)
    )
    const originalStart = current.client.start.bind(current.client)
    vi.spyOn(current.client, 'start').mockImplementation(async (...args) => {
      const accepted = await originalStart(...args)
      acknowledged.resolve()
      return accepted
    })
    const cancelled = vi.spyOn(current.client, 'cancel')
    let settled = false
    const execution = createServerAdapter(async () => current.ports)
      .execute(current.context)
      .then((result) => {
        settled = true
        return result
      })
    try {
      await acknowledged.promise
      await delay(180)
      expect(cancelled).not.toHaveBeenCalled()
      expect(settled).toBe(false)
      expect(current.store.tasks.get(current.binding.command)?.cancellationKey).toBeNull()
      release.resolve()
      const result = await execution
      expect(result.exitCode).toBe(0)
      expect(result.resultJson?.status).toBe('succeeded')
      expect(current.deps.launch).toHaveBeenCalledOnce()
      expect(cancelled).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      await execution
    }
  })
})
