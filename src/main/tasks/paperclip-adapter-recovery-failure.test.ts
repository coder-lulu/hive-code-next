import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalTaskClient } from './local-task-client'
import { createServerAdapter } from './paperclip-runtime-adapter'
import { taskAdapterFixture } from './task-adapter.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { TaskExecutionError } from './task-execution-error'

let fixture: Awaited<ReturnType<typeof taskAdapterFixture>> | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await fixture?.close()
  fixture = undefined
})

describe('recovery failures preserve the original running task', () => {
  it.each(['observe', 'acknowledgement', 'renewal'])(
    'does not request shutdown after %s fails without an operator cancellation',
    async (failure) => {
      fixture = await taskAdapterFixture()
      const current = fixture
      await current.client.start(current.binding.command, current.binding.commandFingerprint)
      await current.host.drain()
      const original = current.store.tasks.get(current.binding.command)!
      expect(original.status).toBe('running')
      const cancel = vi.spyOn(current.client, 'cancel')
      const start = vi.spyOn(current.client, 'start')
      const reconcile = vi.spyOn(current.client, 'reconcile')
      if (failure === 'observe') {
        const denied = new LocalTaskClient({
          baseUrl: current.transport.baseUrl,
          secret: 'a'.repeat(43)
        })
        vi.spyOn(current.client, 'observe').mockImplementation(denied.observe.bind(denied))
      } else if (failure === 'acknowledgement') {
        current.ports.onObservation = vi.fn(async () => {
          throw new Error('synthetic acknowledgement failure')
        })
      } else {
        let now = TASK_TEST_NOW
        vi.spyOn(Date, 'now').mockImplementation(() => now)
        current.ports.waitTimeoutMs = 120_000
        current.ports.resolveBinding = vi
          .fn()
          .mockResolvedValueOnce(current.binding)
          .mockRejectedValue(new TaskExecutionError('FORBIDDEN'))
        current.ports.onObservation = vi.fn(async () => {
          now = TASK_TEST_NOW + 60_001
        })
      }
      const result = await createServerAdapter(async () => current.ports).recover(current.context)
      expect(result.errorCode).toBe('OUTCOME_UNKNOWN')
      expect(result.sessionParams?.executionId).toBe(current.binding.command.executionId)
      expect(cancel).not.toHaveBeenCalled()
      expect(start).not.toHaveBeenCalled()
      expect(reconcile).not.toHaveBeenCalled()
      expect(current.store.tasks.get(current.binding.command)).toEqual(original)
      expect(current.deps.launch).toHaveBeenCalledOnce()
      expect(current.deps.stop).not.toHaveBeenCalled()
    }
  )
})
