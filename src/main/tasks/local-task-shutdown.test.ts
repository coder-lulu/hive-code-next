import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLocalTaskTransport } from './local-task-transport'
import { taskAdapterFixture } from './task-adapter.test-fixture'

let fixture: Awaited<ReturnType<typeof taskAdapterFixture>> | undefined
afterEach(async () => {
  await fixture?.close()
  fixture = undefined
})

describe('local task service shutdown boundaries', () => {
  it('closes active HTTP connections without waiting for a stalled host handler', async () => {
    let release!: () => void
    const stalled = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    const transport = await startLocalTaskTransport({
      host: {
        start: vi.fn(async () => {
          entered()
          await stalled
          throw new Error('Test release')
        }),
        observe: vi.fn(),
        cancel: vi.fn(),
        reconcile: vi.fn(),
        workflowOutcome: vi.fn(),
        workflowCommands: vi.fn(),
        workflowArtifact: vi.fn()
      },
      authenticate: () => ({ operationCallerKey: 'service:test' }),
      capabilities: () => ({})
    })
    const response = fetch(`${transport.baseUrl}/execution/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: '{}'
    }).catch(() => null)
    await entering
    const closing = transport.close()
    const bounded = await Promise.race([closing.then(() => true), delay(150, false)])
    release()
    await response
    await closing
    expect(bounded).toBe(true)
  })
  it('makes repeated and concurrent close calls idempotent', async () => {
    const transport = await startLocalTaskTransport({
      host: {
        start: vi.fn(),
        observe: vi.fn(),
        cancel: vi.fn(),
        reconcile: vi.fn(),
        workflowOutcome: vi.fn(),
        workflowCommands: vi.fn(),
        workflowArtifact: vi.fn()
      },
      authenticate: () => ({ operationCallerKey: 'service:test' }),
      capabilities: () => ({})
    })
    await expect(Promise.all([transport.close(), transport.close()])).resolves.toEqual([
      undefined,
      undefined
    ])
    await expect(transport.close()).resolves.toBeUndefined()
  })
  it('does not admit or launch a request whose authorization completes after shutdown', async () => {
    fixture = await taskAdapterFixture()
    const current = fixture
    const originalAuthorize = current.deps.authorize
    let release!: () => void
    const stalled = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    current.deps.authorize = vi.fn(async (caller, command, action) => {
      entered()
      await stalled
      return originalAuthorize(caller, command, action)
    })
    const starting = current.client
      .start(current.binding.command, current.binding.commandFingerprint)
      .catch(() => null)
    await entering
    const closing = current.transport.close()
    await Promise.race([closing, delay(150)])
    release()
    await starting
    await closing
    await current.host.drain()
    expect(current.store.tasks.get(current.binding.command)).toBeNull()
    expect(current.deps.launch).not.toHaveBeenCalled()
  })
})
