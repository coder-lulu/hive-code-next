import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createdModelEvent,
  modelBrokerFixture,
  modelResponse,
  modelStartParams
} from './task-model-broker.test-fixture'
import {
  TASK_MODEL_IDLE_TIMEOUT_MS,
  TASK_MODEL_REQUEST_TIMEOUT_MS
} from './task-model-channel-protocol'

const fixtures: ReturnType<typeof modelBrokerFixture>[] = []
function fixture(overrides: Parameters<typeof modelBrokerFixture>[0] = {}) {
  const result = modelBrokerFixture(overrides)
  fixtures.push(result)
  return result
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(async () => {
  for (const item of fixtures.splice(0)) {
    await item.channel.close()
  }
  vi.useRealTimers()
})

describe('model broker fencing and disposal', () => {
  it.each([
    null,
    { Authorization: 'Bearer offline_fixture', 'ChatGPT-Account-Id': 'wrong' },
    { Authorization: 'Basic invalid', 'ChatGPT-Account-Id': 'fixture-account' }
  ])('refuses missing or mismatched selected-account authentication %#', async (auth) => {
    const f = fixture({ readAuth: async () => auth })
    await expect(f.channel.start(modelStartParams())).rejects.toThrow('TASK_MODEL_AUTH_UNAVAILABLE')
    expect(f.reserveDispatch).toHaveBeenCalledTimes(1)
    expect(f.request).not.toHaveBeenCalled()
  })

  it('does not expose malformed credential content or arbitrary auth errors', async () => {
    const f = fixture({
      readAuth: async () => {
        throw new Error('secret credential fragment')
      }
    })
    await expect(f.channel.start(modelStartParams())).rejects.toMatchObject({
      message: 'TASK_MODEL_AUTH_UNAVAILABLE',
      diagnostic: { phase: 'auth' }
    })
    expect(f.request).not.toHaveBeenCalled()
  })

  it('refuses a failed original dispatch reservation before reading credentials', async () => {
    const f = fixture({
      reserveDispatch: async () => {
        throw new Error('private transaction data')
      }
    })
    await expect(f.channel.start(modelStartParams())).rejects.toMatchObject({
      message: 'TASK_MODEL_UPSTREAM_UNAVAILABLE',
      diagnostic: { phase: 'reservation' }
    })
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'TASK_MODEL_AUTH_UNAVAILABLE'],
    [403, 'TASK_MODEL_AUTH_UNAVAILABLE'],
    [429, 'TASK_MODEL_LIMIT_UNAVAILABLE'],
    [500, 'TASK_MODEL_UPSTREAM_UNAVAILABLE']
  ])('sanitizes upstream status %s and cancels its response body', async (status, code) => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), { status })
    const f = fixture({ request: async () => response })
    await expect(f.channel.start(modelStartParams())).rejects.toMatchObject({
      message: String(code),
      diagnostic: { phase: 'response', code, httpStatus: status }
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(f.reserveDispatch).toHaveBeenCalledTimes(1)
  })

  it.each(['redirected', 'url', 'content-type', 'content-encoding'])(
    'disposes rejected successful replies for %s without reading their contents',
    async (kind) => {
      const response = modelResponse()
      if (kind === 'redirected') {
        Object.defineProperty(response.reply, 'redirected', { value: true })
      } else if (kind === 'url') {
        Object.defineProperty(response.reply, 'url', { value: 'https://unapproved.test' })
      } else {
        response.reply.headers.set(kind, kind === 'content-type' ? 'application/json' : 'unknown')
      }
      const f = fixture({ request: async () => response.reply })
      await expect(f.channel.start(modelStartParams())).rejects.toThrow(/^TASK_MODEL_/)
      expect(response.cancel).toHaveBeenCalledTimes(1)
      expect(response.pull).not.toHaveBeenCalled()
    }
  )

  it('fences a pending auth read and cannot dispatch when it completes late', async () => {
    const auth = deferred<Record<string, string> | null>()
    const readAuth = vi.fn(async () => auth.promise)
    const f = fixture({ readAuth })
    const params = modelStartParams()
    const started = f.channel.start(params)
    const rejected = expect(started).rejects.toThrow('TASK_MODEL_REQUEST_ABORTED')
    await vi.waitFor(() => expect(readAuth).toHaveBeenCalledTimes(1))
    await f.channel.cancel({ requestId: params.requestId })
    await rejected
    auth.resolve({
      Authorization: 'Bearer offline_fixture',
      'ChatGPT-Account-Id': 'fixture-account'
    })
    await Promise.resolve()
    expect(f.request).not.toHaveBeenCalled()
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_CHANNEL_UNAVAILABLE'
    )
  })

  it('cancels a late fetch response even if its test seam ignored AbortSignal', async () => {
    const response = modelResponse()
    const pending = deferred<Response>()
    const request = vi.fn<typeof fetch>(async () => pending.promise)
    const f = fixture({ request })
    const params = modelStartParams()
    const started = f.channel.start(params)
    const rejected = expect(started).rejects.toThrow('TASK_MODEL_REQUEST_ABORTED')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await f.channel.close()
    await rejected
    pending.resolve(response.reply)
    await vi.waitFor(() => expect(response.cancel).toHaveBeenCalledTimes(1))
    expect(response.pull).not.toHaveBeenCalled()
  })

  it('rechecks original authority after fetch and rejects its response without delivering it', async () => {
    let current = true
    const response = modelResponse()
    const f = fixture({
      assertCurrent: () => {
        if (!current) {
          throw new Error('revoked')
        }
      },
      request: async () => {
        current = false
        return response.reply
      }
    })
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_AUTHORITY_REVOKED'
    )
    expect(response.cancel).toHaveBeenCalledTimes(1)
    expect(response.pull).not.toHaveBeenCalled()
  })

  it('cancel aborts a pending pull, notifies once, and cannot admit a fresh turn', async () => {
    let reads = 0
    const cancel = vi.fn()
    const request = async () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (reads++ === 0) {
                controller.enqueue(Buffer.from(createdModelEvent))
              }
            },
            cancel
          },
          { highWaterMark: 0 }
        ),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    const f = fixture({ request })
    const failed = vi.fn()
    f.channel.onFailure(failed)
    const params = modelStartParams()
    await f.channel.start(params)
    await f.channel.next({ requestId: params.requestId, sequence: 0 })
    const pulling = f.channel.next({ requestId: params.requestId, sequence: 1 })
    const rejected = expect(pulling).rejects.toThrow(/^TASK_MODEL_/)
    await f.channel.cancel({ requestId: params.requestId })
    await rejected
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(failed).toHaveBeenCalledTimes(1)
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_CHANNEL_UNAVAILABLE'
    )
  })

  it('refuses concurrent downstream pulls and closes the pending one', async () => {
    const f = fixture({
      request: async () =>
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { 'content-type': 'text/event-stream' }
        })
    })
    const params = modelStartParams()
    await f.channel.start(params)
    const waiting = expect(
      f.channel.next({ requestId: params.requestId, sequence: 0 })
    ).rejects.toThrow(/^TASK_MODEL_/)
    await expect(f.channel.next({ requestId: params.requestId, sequence: 0 })).rejects.toThrow(
      'TASK_MODEL_REQUEST_REFUSED'
    )
    await waiting
  })

  it('rejects zero-progress upstream chunks without spinning', async () => {
    const cancel = vi.fn()
    const f = fixture({
      request: async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                controller.enqueue(new Uint8Array())
              },
              cancel
            },
            { highWaterMark: 0 }
          ),
          { headers: { 'content-type': 'text/event-stream' } }
        )
    })
    const params = modelStartParams()
    await f.channel.start(params)
    await expect(f.channel.next({ requestId: params.requestId, sequence: 0 })).rejects.toThrow(
      'TASK_MODEL_STREAM_REFUSED'
    )
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('closes promptly even if upstream body cancellation does not cooperate', async () => {
    const f = fixture({
      request: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel: () => new Promise<void>(() => undefined)
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
    })
    await f.channel.start(modelStartParams())
    await expect(f.channel.close()).resolves.toBeUndefined()
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_CHANNEL_UNAVAILABLE'
    )
  })

  it('enforces absolute and idle timeouts with no renewed dispatch', async () => {
    vi.useFakeTimers()
    const f = fixture({
      request: async () =>
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { 'content-type': 'text/event-stream' }
        })
    })
    const params = modelStartParams()
    await f.channel.start(params)
    const waiting = expect(
      f.channel.next({ requestId: params.requestId, sequence: 0 })
    ).rejects.toThrow(/^TASK_MODEL_/)
    await vi.advanceTimersByTimeAsync(TASK_MODEL_IDLE_TIMEOUT_MS)
    await waiting
    const absolute = fixture()
    await absolute.channel.start(modelStartParams())
    await vi.advanceTimersByTimeAsync(TASK_MODEL_REQUEST_TIMEOUT_MS)
    await expect(absolute.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_CHANNEL_UNAVAILABLE'
    )
  })
})
