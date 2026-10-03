import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalTaskClient } from './local-task-client'
import { createLocalTaskRequest } from './local-task-http-client'
import { taskAdapterFixture } from './task-adapter.test-fixture'
import { taskCommand } from './task-execution.test-fixture'

let fixture: Awaited<ReturnType<typeof taskAdapterFixture>> | undefined
afterEach(async () => {
  await fixture?.close()
  fixture = undefined
})

describe('strict local task client', () => {
  it('round-trips acceptance and cancellation against the authenticated host', async () => {
    fixture = await taskAdapterFixture()
    const accepted = await fixture.client.start(
      fixture.binding.command,
      fixture.binding.commandFingerprint
    )
    expect(accepted.status).toBe('accepted')
    expect((await fixture.client.reconcile(fixture.query)).result).toBeNull()
    const cancelled = await fixture.client.cancel({
      ...fixture.query,
      kind: 'execution.cancel',
      task: fixture.binding.command.task,
      idempotencyKey: 'cancel:client',
      reason: 'user_requested'
    })
    expect(cancelled.result?.status).toBe('cancelled')
    expect(fixture.deps.launch).toHaveBeenCalledTimes(1)
  })
  it('preserves a refusal code without exposing response messages', async () => {
    const client = new LocalTaskClient({
      baseUrl: 'http://127.0.0.1:12345',
      secret: 'a'.repeat(43),
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'FORBIDDEN', message: 'private-provider-key' } }),
            { status: 403 }
          )
      )
    })
    await expect(client.capabilities()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'FORBIDDEN'
    })
  })
  it('refuses non-local or credential-bearing endpoint configuration', () => {
    for (const baseUrl of [
      'https://example.com',
      'http://localhost:12345',
      'http://user:pass@127.0.0.1:12345',
      'http://127.0.0.1:12345/path'
    ]) {
      expect(() => new LocalTaskClient({ baseUrl, secret: 'a'.repeat(43) })).toThrow(
        'INVALID_REQUEST'
      )
    }
  })
  it('never forwards credentials when a relative URL changes origin', async () => {
    const fetchImpl = vi.fn()
    const request = createLocalTaskRequest({
      baseUrl: 'http://127.0.0.1:12345',
      secret: 'a'.repeat(43),
      fetch: fetchImpl
    })
    await expect(request('/\\example.com')).rejects.toThrow('INVALID_REQUEST')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('rejects an oversized chunked response before JSON parsing', async () => {
    const client = new LocalTaskClient({
      baseUrl: 'http://127.0.0.1:12345',
      secret: 'a'.repeat(43),
      fetch: vi.fn(async () => new Response('x'.repeat(64 * 1024 + 1)))
    })
    await expect(client.capabilities()).rejects.toThrow('SERVICE_UNAVAILABLE')
  })
  it('treats a cross-bound accepted receipt as an unknown outcome', async () => {
    fixture = await taskAdapterFixture()
    const accepted = await fixture.client.start(
      fixture.binding.command,
      fixture.binding.commandFingerprint
    )
    const client = new LocalTaskClient({
      baseUrl: 'http://127.0.0.1:12345',
      secret: 'a'.repeat(43),
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ ...accepted, executionId: 'execution:foreign' }), {
            status: 202
          })
      )
    })
    await expect(client.start(taskCommand(), fixture.binding.commandFingerprint)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
  })
  it('rejects cursor regression in observations', async () => {
    fixture = await taskAdapterFixture()
    await fixture.client.start(fixture.binding.command, fixture.binding.commandFingerprint)
    const observation = await fixture.client.reconcile(fixture.query)
    const client = new LocalTaskClient({
      baseUrl: 'http://127.0.0.1:12345',
      secret: 'a'.repeat(43),
      fetch: vi.fn(
        async () => new Response(JSON.stringify({ ...observation, cursor: 0, events: [] }))
      )
    })
    await expect(
      client.observe({ ...fixture.query, kind: 'execution.observe', afterSequence: 1, limit: 8 })
    ).rejects.toThrow('OUTCOME_UNKNOWN')
  })
})
