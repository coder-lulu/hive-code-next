import { request as httpRequest, ServerResponse, type ClientRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskDockerModelHttpBridge } from './task-docker-model-http'
import {
  TASK_MODEL_CHUNK_BYTES,
  TASK_MODEL_IDLE_TIMEOUT_MS,
  TASK_MODEL_REQUEST_BYTES,
  TASK_MODEL_REQUEST_LIMIT,
  TASK_MODEL_REQUEST_TIMEOUT_MS,
  TASK_MODEL_RPC_CANCEL,
  TASK_MODEL_RPC_NEXT,
  TASK_MODEL_RPC_START
} from './task-model-channel-protocol'

type Bridge = Awaited<ReturnType<typeof createTaskDockerModelHttpBridge>>
const bridges: Bridge[] = []
const clients: ClientRequest[] = []
function nextSequence(params: unknown): number {
  if (
    typeof params !== 'object' ||
    params === null ||
    !('sequence' in params) ||
    typeof params.sequence !== 'number'
  ) {
    throw new Error('Expected next request')
  }
  return params.sequence
}

function startParams(params: unknown): { requestId: string; bodyBase64: string } {
  if (
    typeof params !== 'object' ||
    params === null ||
    Object.keys(params).length !== 2 ||
    !('requestId' in params) ||
    !('bodyBase64' in params) ||
    typeof params.requestId !== 'string' ||
    typeof params.bodyBase64 !== 'string'
  ) {
    throw new Error('Expected start request')
  }
  return { requestId: params.requestId, bodyBase64: params.bodyBase64 }
}
afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.destroy()
  }
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()))
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function fixture(handle?: (method: string, params: unknown) => Promise<unknown>) {
  const request = vi.fn(
    handle ??
      (async (method, params) => {
        if (method === TASK_MODEL_RPC_START) {
          return { status: 200, contentType: 'text/event-stream' }
        }
        if (method === TASK_MODEL_RPC_CANCEL) {
          return { cancelled: true }
        }
        return {
          sequence: nextSequence(params),
          bodyBase64: Buffer.from('data: {}\n\n').toString('base64'),
          done: true
        }
      })
  )
  const onFailure = vi.fn()
  const bridge = await createTaskDockerModelHttpBridge({ request, onFailure, port: 0 })
  bridges.push(bridge)
  return { bridge, request, onFailure }
}
function send(
  bridge: Bridge,
  options: {
    method?: string
    path?: string
    headers?: Record<string, string>
    body?: string
    end?: boolean
  } = {}
) {
  const body = options.body ?? '{"stream":true}'
  let client!: ClientRequest
  const result = new Promise<{ status: number; body: string; headers: Record<string, unknown> }>(
    (resolve, reject) => {
      client = httpRequest(
        {
          hostname: bridge.address.host,
          port: bridge.address.port,
          method: options.method ?? 'POST',
          path: options.path ?? '/v1/responses',
          headers: {
            'content-type': 'application/json',
            ...(options.end === false
              ? { 'transfer-encoding': 'chunked' }
              : { 'content-length': String(Buffer.byteLength(body)) }),
            ...options.headers
          }
        },
        (response) => {
          const chunks: Buffer[] = []
          response
            .on('data', (chunk) => chunks.push(chunk))
            .once('error', reject)
            .once('end', () =>
              resolve({
                status: response.statusCode!,
                body: Buffer.concat(chunks).toString(),
                headers: response.headers
              })
            )
        }
      )
      client.once('error', reject)
      client.once('connect', (response, socket, head) => {
        resolve({ status: response.statusCode!, body: head.toString(), headers: response.headers })
        socket.destroy()
      })
      clients.push(client)
      if (options.end !== false) {
        client.end(body)
      }
    }
  )
  void result.catch(() => undefined)
  return { client, result }
}
const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('bounded guest loopback model HTTP', () => {
  it('binds only loopback, passes canonical body and fixed private params, and returns only fixed SSE headers', async () => {
    const f = await fixture()
    const result = await send(f.bridge, {
      headers: {
        originator: 'codex_app_test',
        version: '0.159.2',
        'x-codex-turn-metadata': '{"test":true}',
        'x-openai-internal-codex-responses-lite': 'true'
      }
    }).result
    expect(f.bridge.address.host).toBe('127.0.0.1')
    expect(result.status).toBe(200)
    expect(result.body).toBe('data: {}\n\n')
    expect(result.headers['content-type']).toBe('text/event-stream')
    const start = f.request.mock.calls[0]!
    expect(start[0]).toBe(TASK_MODEL_RPC_START)
    expect(Object.keys(startParams(start[1]))).toEqual(['requestId', 'bodyBase64'])
    expect(Buffer.from(startParams(start[1]).bodyBase64, 'base64').toString()).toBe(
      '{"stream":true}'
    )
    expect(f.request.mock.calls.some(([method]) => method === TASK_MODEL_RPC_CANCEL)).toBe(false)
  })

  it.each(['GET', 'PUT', 'DELETE', 'CONNECT'])(
    'rejects method %s before private dispatch',
    async (method) => {
      const f = await fixture()
      expect((await send(f.bridge, { method }).result).status).toBe(
        method === 'CONNECT' ? 400 : 405
      )
      expect(f.request).not.toHaveBeenCalled()
    }
  )
  it.each([
    '/v1/responses?x=1',
    '/v1/responses/',
    '/v1/chat/completions',
    'http://127.0.0.1/v1/responses'
  ])('rejects nonexact path %s', async (path) => {
    const f = await fixture()
    expect((await send(f.bridge, { path }).result).status).toBe(404)
    expect(f.request).not.toHaveBeenCalled()
  })
  it.each([
    ['authorization', 'Bearer synthetic-secret'],
    ['cookie', 'synthetic=secret'],
    ['chatgpt-account-id', 'synthetic'],
    ['openai-organization', 'synthetic'],
    ['proxy-authorization', 'synthetic'],
    ['x-codex-turn-state', 'synthetic'],
    ['x-openai-subagent', 'synthetic'],
    ['x-codex-parent-thread-id', 'synthetic'],
    ['version', 'wrong'],
    ['x-openai-internal-codex-responses-lite', 'false'],
    ['session-id', 'x'.repeat(161)],
    ['x-codex-turn-metadata', 'x'.repeat(4097)],
    ['host', 'localhost'],
    ['connection', 'upgrade'],
    ['upgrade', 'websocket']
  ])('rejects sensitive, oversized, or unsupported header %s', async (name, value) => {
    const f = await fixture()
    expect((await send(f.bridge, { headers: { [name]: value } }).result).status).toBe(400)
    expect(f.request).not.toHaveBeenCalled()
  })

  it('rejects a body over the byte limit before dispatching start', async () => {
    const f = await fixture()
    expect(
      (
        await send(f.bridge, {
          headers: { 'content-length': String(TASK_MODEL_REQUEST_BYTES + 1) }
        }).result
      ).status
    ).toBe(413)
    expect(f.request).not.toHaveBeenCalled()
    const streaming = send(f.bridge, { end: false })
    streaming.client.write('x'.repeat(TASK_MODEL_REQUEST_BYTES + 1))
    const outcome = await streaming.result.then(
      (value) => value.status,
      () => 'closed'
    )
    expect([413, 'closed']).toContain(outcome)
    expect(f.request).not.toHaveBeenCalled()
  })

  it('accepts one active request and has a finite completed-request budget', async () => {
    let resolveStart!: (result: unknown) => void
    const f = await fixture(async (method, params) => {
      if (method === TASK_MODEL_RPC_START && !resolveStart) {
        return new Promise((resolve) => {
          resolveStart = resolve
        })
      }
      if (method === TASK_MODEL_RPC_START) {
        return { status: 200, contentType: 'text/event-stream' }
      }
      return { sequence: nextSequence(params), bodyBase64: '', done: true }
    })
    const first = send(f.bridge)
    await vi.waitFor(() => expect(resolveStart).toBeTypeOf('function'))
    expect((await send(f.bridge).result).status).toBe(429)
    resolveStart({ status: 200, contentType: 'text/event-stream' })
    expect((await first.result).status).toBe(200)
    for (let index = 1; index < TASK_MODEL_REQUEST_LIMIT; index++) {
      expect((await send(f.bridge).result).status).toBe(200)
    }
    expect((await send(f.bridge).result).status).toBe(429)
    expect(f.request.mock.calls.filter(([method]) => method === TASK_MODEL_RPC_START)).toHaveLength(
      TASK_MODEL_REQUEST_LIMIT
    )
  })

  it.each([
    { sequence: 1, bodyBase64: '', done: true },
    { sequence: 0, bodyBase64: 'YR==', done: true },
    { sequence: 0, bodyBase64: '', done: false },
    { sequence: 0, bodyBase64: 'eA==', done: 'false' },
    { sequence: 0, bodyBase64: 'eA==', done: true, headers: { authorization: 'synthetic' } },
    {
      sequence: 0,
      bodyBase64: Buffer.alloc(TASK_MODEL_CHUNK_BYTES + 1).toString('base64'),
      done: true
    }
  ])('rejects invalid next result without reflecting any host fields', async (next) => {
    const f = await fixture(async (method) =>
      method === TASK_MODEL_RPC_START
        ? { status: 200, contentType: 'text/event-stream' }
        : method === TASK_MODEL_RPC_CANCEL
          ? { cancelled: true }
          : next
    )
    const result = await send(f.bridge).result
    expect(result.status).toBe(503)
    expect(result.body).toBe('TASK_MODEL_REQUEST_FAILED\n')
    expect(f.onFailure).toHaveBeenCalledTimes(1)
  })

  it('sanitizes host start and late streaming failures and sends cancellation once', async () => {
    const f = await fixture(async () => {
      throw new Error('synthetic-account-token-header')
    })
    const result = await send(f.bridge).result
    expect(result.status).toBe(503)
    expect(result.body).not.toContain('synthetic')
    const late = await fixture(async (method, params) => {
      if (method === TASK_MODEL_RPC_START) {
        return { status: 200, contentType: 'text/event-stream' }
      }
      if (method === TASK_MODEL_RPC_CANCEL) {
        return { cancelled: true }
      }
      if (nextSequence(params) > 0) {
        throw new Error('synthetic-private-error')
      }
      return {
        sequence: 0,
        bodyBase64: Buffer.from('data: {}\n\n').toString('base64'),
        done: false
      }
    })
    await expect(send(late.bridge).result).rejects.toThrow()
    expect(late.onFailure).toHaveBeenCalledTimes(1)
    expect(
      late.request.mock.calls.filter(([method]) => method === TASK_MODEL_RPC_CANCEL)
    ).toHaveLength(1)
  })

  it('cancels a disconnected client and closes promptly while RPC never settles', async () => {
    const f = await fixture(async (method) =>
      method === TASK_MODEL_RPC_START
        ? { status: 200, contentType: 'text/event-stream' }
        : new Promise(() => undefined)
    )
    const client = send(f.bridge)
    await vi.waitFor(() =>
      expect(f.request.mock.calls.some(([method]) => method === TASK_MODEL_RPC_NEXT)).toBe(true)
    )
    client.client.destroy()
    await vi.waitFor(() =>
      expect(f.request.mock.calls.some(([method]) => method === TASK_MODEL_RPC_CANCEL)).toBe(true)
    )
    await f.bridge.close()
    await expect(client.result).rejects.toThrow()
    const active = await fixture(async () => new Promise(() => undefined))
    const pending = send(active.bridge)
    await vi.waitFor(() => expect(active.request).toHaveBeenCalledTimes(1))
    await active.bridge.close()
    await expect(pending.result).rejects.toThrow()
  })

  it('waits for HTTP drain before pulling another host chunk and closes a blocked consumer', async () => {
    let releaseDrain: (() => void) | undefined
    const original = ServerResponse.prototype.write
    let once = true
    vi.spyOn(ServerResponse.prototype, 'write').mockImplementation(function (
      this: ServerResponse,
      ...args: Parameters<typeof original>
    ) {
      const result = original.apply(this, args)
      if (once) {
        once = false
        releaseDrain = () => this.emit('drain')
        return false
      }
      return result
    })
    const f = await fixture(async (method, params) =>
      method === TASK_MODEL_RPC_START
        ? { status: 200, contentType: 'text/event-stream' }
        : {
            sequence: nextSequence(params),
            bodyBase64: Buffer.from('data: {}\n\n').toString('base64'),
            done: nextSequence(params) === 1
          }
    )
    const sent = send(f.bridge)
    await vi.waitFor(() => expect(releaseDrain).toBeDefined())
    await nextTick()
    expect(f.request.mock.calls.filter(([method]) => method === TASK_MODEL_RPC_NEXT)).toHaveLength(
      1
    )
    releaseDrain?.()
    expect((await sent.result).body).toBe('data: {}\n\ndata: {}\n\n')
  })

  it('enforces idle and absolute request deadlines without waiting for hanging host RPC', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const f = await fixture(async () => new Promise(() => undefined))
    const request = send(f.bridge)
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(TASK_MODEL_IDLE_TIMEOUT_MS)
    expect((await request.result).status).toBe(408)
    expect(f.request.mock.calls.some(([method]) => method === TASK_MODEL_RPC_CANCEL)).toBe(true)
    const slow = await fixture()
    const body = send(slow.bridge, { end: false })
    body.client.write('x')
    await nextTick()
    for (let elapsed = 0; elapsed < TASK_MODEL_REQUEST_TIMEOUT_MS; elapsed += 20_000) {
      await vi.advanceTimersByTimeAsync(20_000)
      body.client.write('x')
      await nextTick()
    }
    expect((await body.result).status).toBe(408)
    expect(slow.request).not.toHaveBeenCalled()
  })

  it.each([
    { status: 201, contentType: 'text/event-stream' },
    { status: 200, contentType: 'application/json' },
    { status: 200, contentType: 'text/event-stream', headers: { authorization: 'synthetic' } }
  ])('sanitizes unsupported start envelopes', async (start) => {
    const f = await fixture(async (method) =>
      method === TASK_MODEL_RPC_START ? start : { cancelled: true }
    )
    const result = await send(f.bridge).result
    expect(result.status).toBe(503)
    expect(result.body).toBe('TASK_MODEL_REQUEST_FAILED\n')
    expect(f.onFailure).toHaveBeenCalledTimes(1)
  })

  it('bounds cumulative raw headers and refuses trailers before private start', async () => {
    const f = await fixture()
    const huge = await send(f.bridge, { headers: { 'user-agent': 'x'.repeat(20 * 1024) } }).result
    expect([400, 431]).toContain(huge.status)
    const trailer = send(f.bridge, { end: false })
    trailer.client.write('{}')
    trailer.client.addTrailers({ 'x-synthetic-trailer': 'discard' })
    trailer.client.end()
    expect((await trailer.result).status).toBe(400)
    expect(f.request).not.toHaveBeenCalled()
  })

  it('bounds total response bytes independently of individually valid chunks', async () => {
    const bodyBase64 = Buffer.alloc(TASK_MODEL_CHUNK_BYTES, 120).toString('base64')
    const f = await fixture(async (method, params) => {
      if (method === TASK_MODEL_RPC_START) {
        return { status: 200, contentType: 'text/event-stream' }
      }
      if (method === TASK_MODEL_RPC_CANCEL) {
        return { cancelled: true }
      }
      return { sequence: nextSequence(params), bodyBase64, done: false }
    })
    await expect(send(f.bridge).result).rejects.toThrow()
    expect(f.onFailure).toHaveBeenCalledTimes(1)
    expect(f.request.mock.calls.filter(([method]) => method === TASK_MODEL_RPC_NEXT)).toHaveLength(
      342
    )
    expect(
      f.request.mock.calls.filter(([method]) => method === TASK_MODEL_RPC_CANCEL)
    ).toHaveLength(1)
  })

  it('closes sockets and joins concurrent close while awaiting HTTP drain', async () => {
    let blocked = false
    const original = ServerResponse.prototype.write
    vi.spyOn(ServerResponse.prototype, 'write').mockImplementation(function (
      this: ServerResponse,
      ...args: Parameters<typeof original>
    ) {
      original.apply(this, args)
      blocked = true
      return false
    })
    const f = await fixture()
    const pending = send(f.bridge)
    await vi.waitFor(() => expect(blocked).toBe(true))
    await Promise.all([f.bridge.close(), f.bridge.close()])
    await expect(pending.result).rejects.toThrow()
    expect(
      f.request.mock.calls.filter(([method]) => method === TASK_MODEL_RPC_CANCEL)
    ).toHaveLength(1)
  })

  it('never accepts a caller-selected production port', async () => {
    await expect(
      createTaskDockerModelHttpBridge({ request: vi.fn(), onFailure: vi.fn(), port: 41001 })
    ).rejects.toThrow('TASK_MODEL_REQUEST_FAILED')
  })
})
