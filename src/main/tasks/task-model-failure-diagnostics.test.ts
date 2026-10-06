import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskExecutionError } from './task-execution-error'
import { modelBrokerFixture, modelStartParams } from './task-model-broker.test-fixture'
import { taskFailure, type TaskFailureError } from './task-failure-diagnostic'

const fixtures: ReturnType<typeof modelBrokerFixture>[] = []
function fixture() {
  const f = modelBrokerFixture()
  fixtures.push(f)
  return f
}
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.channel.close()))
})

describe('first original model failure diagnostics', () => {
  it('drops malicious code, cause getters and prototype traps without leaking or blocking cleanup', async () => {
    const errors = [
      Object.assign(new Error('https://private.invalid/token-secret'), {
        code: 'ECONNRESET_token_secret'
      }),
      Object.defineProperties(new Error('private path secret'), {
        code: {
          get() {
            throw new Error('private code getter secret')
          }
        },
        cause: {
          get() {
            throw new Error('private cause getter secret')
          }
        }
      }),
      new Proxy(new Error('private prototype secret'), {
        getPrototypeOf() {
          throw new Error('private trap secret')
        }
      })
    ]
    for (const error of errors) {
      const f = fixture()
      const failed = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(failed)
      f.request.mockRejectedValue(error)
      await expect(f.channel.start(modelStartParams())).rejects.toThrow(
        'TASK_MODEL_UPSTREAM_UNAVAILABLE'
      )
      const safe = failed.mock.calls[0][0]
      expect(safe.diagnostic).toEqual({
        phase: 'fetch',
        category: 'unavailable',
        code: 'TASK_MODEL_UPSTREAM_UNAVAILABLE'
      })
      expect(safe.stack).toBe('TASK_MODEL_UPSTREAM_UNAVAILABLE')
      expect(JSON.stringify(safe)).not.toContain('secret')
      await f.channel.close()
    }
    expect(
      taskFailure(
        { code: 'FORBIDDEN', cause: { code: 'private/token-secret' } },
        'authorization_monitor',
        'OUTCOME_UNKNOWN'
      ).diagnostic
    ).toEqual({ phase: 'authorization_monitor', category: 'authorization', code: 'FORBIDDEN' })
  })
  it.each([401, 403, 429, 500])('retains HTTP %s without response secrets', async (status) => {
    const f = fixture()
    let signal: AbortSignal | undefined
    const observedAbort: boolean[] = []
    const failed = vi.fn(() => {
      observedAbort.push(signal?.aborted ?? true)
    })
    f.channel.onFailure(failed)
    f.request.mockImplementation(async (_input, init) => {
      signal = init?.signal ?? undefined
      return new Response('private response secret', {
        status,
        headers: { authorization: 'Bearer private header secret' }
      })
    })
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(/^TASK_MODEL_/)
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: {
          phase: 'response',
          category: 'http',
          code:
            status === 401 || status === 403
              ? 'TASK_MODEL_AUTH_UNAVAILABLE'
              : status === 429
                ? 'TASK_MODEL_LIMIT_UNAVAILABLE'
                : 'TASK_MODEL_UPSTREAM_UNAVAILABLE',
          httpStatus: status
        }
      })
    )
    expect(JSON.stringify(failed.mock.calls)).not.toContain('secret')
    expect(observedAbort).toEqual([false])
    expect(signal?.aborted).toBe(true)
  })

  it('delivers the same first reservation refusal to late observers', async () => {
    const f = fixture()
    const failed = vi.fn()
    f.channel.onFailure(failed)
    f.reserveDispatch.mockRejectedValue(new TaskExecutionError('CAPACITY_EXCEEDED'))
    await expect(f.channel.start(modelStartParams())).rejects.toThrow('TASK_MODEL_BUDGET_REFUSED')
    const late = vi.fn()
    f.channel.onFailure(late)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(late).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: {
          phase: 'reservation',
          category: 'capacity',
          code: 'TASK_MODEL_BUDGET_REFUSED',
          causeCode: 'CAPACITY_EXCEEDED'
        }
      })
    )
    expect(late.mock.calls[0][0]).toBe(failed.mock.calls[0][0])
    expect(f.request).not.toHaveBeenCalled()
  })

  it('retains a fetch network code and drops URL-bearing messages and malicious code suffixes', async () => {
    const f = fixture()
    const failed = vi.fn()
    f.channel.onFailure(failed)
    f.request.mockRejectedValue(
      new Error('https://private.invalid/token-secret', {
        cause: Object.assign(new Error('private path secret'), { code: 'ECONNRESET' })
      })
    )
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_UPSTREAM_UNAVAILABLE'
    )
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: {
          phase: 'fetch',
          category: 'network',
          code: 'TASK_MODEL_UPSTREAM_UNAVAILABLE',
          networkCode: 'ECONNRESET'
        }
      })
    )
    expect(JSON.stringify(failed.mock.calls)).not.toContain('secret')
    const malicious = fixture()
    const rejected = vi.fn()
    malicious.channel.onFailure(rejected)
    malicious.request.mockRejectedValue(new Error('TASK_MODEL_TOKEN_SECRET'))
    await expect(malicious.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_UPSTREAM_UNAVAILABLE'
    )
    expect(JSON.stringify(rejected.mock.calls)).not.toContain('TOKEN_SECRET')
  })

  it('retains auth and stream phases instead of reporting a later aborted request', async () => {
    for (const phase of ['auth', 'stream']) {
      const f = fixture()
      const failed = vi.fn()
      f.channel.onFailure(failed)
      if (phase === 'auth') {
        f.readAuth.mockRejectedValue(new Error('private auth secret'))
      } else {
        f.request.mockResolvedValue(
          new Response(
            new ReadableStream(
              {
                pull(controller) {
                  controller.error(
                    Object.assign(new Error('private stream secret'), { code: 'ETIMEDOUT' })
                  )
                }
              },
              { highWaterMark: 0 }
            ),
            { headers: { 'content-type': 'text/event-stream' } }
          )
        )
      }
      const params = modelStartParams()
      if (phase === 'stream') {
        await f.channel.start(params)
        await expect(f.channel.next({ requestId: params.requestId, sequence: 0 })).rejects.toThrow(
          'TASK_MODEL_STREAM_REFUSED'
        )
      } else {
        await expect(f.channel.start(params)).rejects.toThrow('TASK_MODEL_AUTH_UNAVAILABLE')
      }
      expect(failed).toHaveBeenCalledOnce()
      expect(failed).toHaveBeenCalledWith(
        expect.objectContaining({ diagnostic: expect.objectContaining({ phase }) })
      )
      expect(JSON.stringify(failed.mock.calls)).not.toContain('secret')
    }
  })
})
