import { afterEach, describe, expect, it, vi } from 'vitest'
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

async function expiringFixture() {
  fixture = await taskAdapterFixture()
  const current = fixture
  let now = TASK_TEST_NOW
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  current.ports.waitTimeoutMs = 120_000
  const authorize = current.deps.authorize
  current.deps.authorize = vi.fn(async (caller, command, action) => {
    if (Date.parse(command.expiresAt) <= now) {
      throw new TaskExecutionError('FORBIDDEN')
    }
    return authorize(caller, command, action)
  })
  current.ports.resolveBinding = vi.fn(async () =>
    now === TASK_TEST_NOW
      ? current.binding
      : {
          ...current.binding,
          command: {
            ...current.binding.command,
            authorizationRef: 'grant:renewed',
            expiresAt: new Date(TASK_TEST_NOW + 180_000).toISOString()
          }
        }
  )
  return {
    current,
    expire: () => {
      now = TASK_TEST_NOW + 60_001
    }
  }
}

describe('long-running Paperclip task authorization', () => {
  it('renews before start if registering cancellation has waited past the grant expiry', async () => {
    const { current, expire } = await expiringFixture()
    current.context.onCancellationReady = vi.fn(async () => {
      expire()
    })
    current.deps.collect = vi.fn(async () => ({
      outcomeRef: 'outcome:test',
      artifactRefs: ['artifact:report']
    }))
    const result = await createServerAdapter(async () => current.ports).execute(current.context)
    expect(result.exitCode).toBe(0)
    expect(current.ports.resolveBinding).toHaveBeenCalledTimes(2)
    expect(current.deps.launch).toHaveBeenCalledTimes(1)
  })
  it('renews only authorization and keeps waiting for the original execution result', async () => {
    const { current, expire } = await expiringFixture()
    current.context.onLog = vi.fn(async () => {
      expire()
      current.deps.collect = vi.fn(async () => ({
        outcomeRef: 'outcome:test',
        artifactRefs: ['artifact:report']
      }))
    })
    const result = await createServerAdapter(async () => current.ports).execute(current.context)
    expect(result.exitCode).toBe(0)
    expect(current.ports.resolveBinding).toHaveBeenCalledTimes(2)
    expect(current.deps.launch).toHaveBeenCalledTimes(1)
    expect(result.sessionParams?.executionId).toBe(current.binding.command.executionId)
    expect(current.deps.authorize).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ authorizationRef: 'grant:renewed' }),
      'reconcile'
    )
  })
  it('renews expired authorization before forwarding operator cancellation', async () => {
    const { current, expire } = await expiringFixture()
    current.context.onLog = vi.fn(async () => {
      expire()
      current.controller.abort()
    })
    const result = await createServerAdapter(async () => current.ports).execute(current.context)
    expect(result.resultJson?.status).toBe('cancelled')
    expect(current.ports.resolveBinding).toHaveBeenCalledTimes(2)
    expect(current.deps.stop).toHaveBeenCalledTimes(1)
    expect(current.deps.launch).toHaveBeenCalledTimes(1)
  })
  it('refuses changed immutable input under a reused declared fingerprint during renewal', async () => {
    const { current, expire } = await expiringFixture()
    current.context.onLog = vi.fn(async () => {
      expire()
      current.ports.resolveBinding = vi.fn(async () => ({
        ...current.binding,
        command: {
          ...current.binding.command,
          inputRef: 'input:changed',
          authorizationRef: 'grant:renewed',
          expiresAt: new Date(TASK_TEST_NOW + 180_000).toISOString()
        }
      }))
    })
    const result = await createServerAdapter(async () => current.ports).execute(current.context)
    expect(current.ports.resolveBinding).toHaveBeenCalled()
    expect(result.errorCode).toBe('OUTCOME_UNKNOWN')
    expect(current.store.tasks.get(current.binding.command)?.command.inputRef).toBe(
      current.binding.command.inputRef
    )
    expect(current.deps.launch).toHaveBeenCalledTimes(1)
  })
})
