import { taskFailureWithInvalidDiagnostics } from './task-model-response-field-diagnostics.test-fixture'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completedModelEvent,
  createdModelEvent,
  finishModelRequest,
  modelBrokerFixture,
  modelStartParams
} from './task-model-broker.test-fixture'
import { taskFailure, type TaskFailureError } from './task-failure-diagnostic'
import { TASK_MODEL_RESPONSE_BYTES } from './task-model-channel-protocol'

const fixtures: ReturnType<typeof modelBrokerFixture>[] = []
const servers: Server[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.channel.close()))
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    })
  )
})
const complete = createdModelEvent + completedModelEvent
function compress(body: string, encoding: string) {
  let bytes = Buffer.from(body)
  for (const coding of encoding
    .toLowerCase()
    .split(',')
    .map((value) => value.trim())) {
    bytes =
      coding === 'identity'
        ? bytes
        : coding === 'br'
          ? brotliCompressSync(bytes)
          : coding === 'deflate'
            ? deflateSync(bytes)
            : gzipSync(bytes)
  }
  return bytes
}
async function endpoint(send: (response: ServerResponse) => void) {
  const server = createServer((_request, response) => send(response))
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Local test endpoint unavailable')
  }
  return `http://127.0.0.1:${address.port}`
}
function fixture(request: typeof fetch) {
  const f = modelBrokerFixture({ request })
  fixtures.push(f)
  return f
}
async function localResponse(options: {
  encoding?: string
  contentType?: string
  body?: string
  bytes?: Buffer
}) {
  const encoding = options.encoding
  const bytes =
    options.bytes ??
    (encoding
      ? compress(options.body ?? complete, encoding)
      : Buffer.from(options.body ?? complete))
  const url = await endpoint((response) => {
    response.writeHead(200, {
      'content-type': options.contentType ?? 'text/event-stream',
      ...(encoding !== undefined ? { 'content-encoding': encoding } : {})
    })
    response.end(bytes)
  })
  return fixture(async (_input, init) => {
    const actual = await fetch(url, { signal: init?.signal })
    // The existing seam keeps decoded bytes/headers while preserving the fixed provider URL guard.
    return new Response(actual.body, { status: actual.status, headers: actual.headers })
  })
}

describe('Fetch-decoded controlled model responses', () => {
  it.each([
    'gzip',
    'deflate',
    'br',
    'x-gzip',
    'GZIP',
    'gzip, br',
    'deflate, gzip',
    'gzip, gzip, gzip, gzip, gzip'
  ])('admits decoded SSE with retained %s header', async (encoding) => {
    const bytes = compress(complete, encoding)
    const url = await endpoint((response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'content-encoding': encoding })
      response.end(bytes)
    })
    const actual = await fetch(url)
    expect(actual.headers.get('content-encoding')).toBe(encoding)
    expect(await actual.clone().text()).toBe(complete)
    const f = fixture(
      async () => new Response(actual.body, { status: actual.status, headers: actual.headers })
    )
    const params = modelStartParams()
    await expect(f.channel.start(params)).resolves.toMatchObject({ status: 200 })
    expect(await finishModelRequest(f.channel, params.requestId)).toBe(complete)
  })

  it.each([
    'text/event-stream; charset="utf-8"',
    'Text/Event-Stream ; charset = "UTF-8"',
    'text/event-stream;\tcharset=utf-8'
  ])('admits only the supported UTF-8 MIME spelling %s', async (contentType) => {
    const f = await localResponse({ contentType })
    const params = modelStartParams()
    await expect(f.channel.start(params)).resolves.toMatchObject({ status: 200 })
    expect(await finishModelRequest(f.channel, params.requestId)).toBe(complete)
  })

  it.each([undefined, 'identity', 'IDENTITY'])(
    'retains unencoded admission with %s coding',
    async (encoding) => {
      const f = await localResponse({ encoding })
      const params = modelStartParams()
      await f.channel.start(params)
      expect(await finishModelRequest(f.channel, params.requestId)).toBe(complete)
    }
  )

  it.each([
    '',
    'unknown',
    'zstd',
    'gzip,',
    ',gzip',
    'identity, gzip',
    'gzip, identity',
    'gzip, unknown',
    `gzip,${' '.repeat(130)}br`
  ])('refuses unsupported or unbounded coding %j with a finite safe reason', async (encoding) => {
    const f = await localResponse({ encoding, bytes: Buffer.from('private response body secret') })
    const failed = vi.fn<(failure: TaskFailureError) => void>()
    f.channel.onFailure(failed)
    await expect(f.channel.start(modelStartParams())).rejects.toMatchObject({
      message: 'TASK_MODEL_STREAM_REFUSED',
      diagnostic: {
        phase: 'response',
        httpStatus: 200,
        responseReason: 'content_encoding'
      }
    })
    expect(JSON.stringify(failed.mock.calls)).not.toContain('secret')
  })

  it('refuses an injected six-coding response and lets global Fetch enforce its own bound', async () => {
    const encoding = 'gzip, gzip, gzip, gzip, gzip, gzip'
    const f = fixture(
      async () =>
        new Response('private encoded body secret', {
          headers: { 'content-type': 'text/event-stream', 'content-encoding': encoding }
        })
    )
    await expect(f.channel.start(modelStartParams())).rejects.toMatchObject({
      diagnostic: { responseReason: 'content_encoding' }
    })
    const real = await localResponse({ encoding, bytes: compress(complete, encoding) })
    await expect(real.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_UPSTREAM_UNAVAILABLE'
    )
  })

  it('drops forged response reasons and never replaces a trusted first failure', () => {
    const first = taskFailure(
      undefined,
      'response',
      'TASK_MODEL_STREAM_REFUSED',
      200,
      'content_type'
    )
    expect(
      taskFailure(first, 'response', 'TASK_MODEL_STREAM_REFUSED', 200, 'content_encoding')
    ).toBe(first)
    const forged: TaskFailureError = taskFailureWithInvalidDiagnostics(
      { responseReason: 'private/header/token-secret' },
      'response',
      'TASK_MODEL_STREAM_REFUSED',
      200,
      'content_type_private_token_secret'
    )
    expect(forged.diagnostic).not.toHaveProperty('responseReason')
    expect(JSON.stringify(forged)).not.toContain('secret')
  })

  it.each([
    'application/json',
    'text/event-stream; charset=iso-8859-1',
    'text/event-stream; private=token-secret',
    'text/event-stream; charset="utf-8"; charset=utf-8'
  ])('refuses MIME %s without retaining its raw value', async (contentType) => {
    const f = await localResponse({ contentType })
    await expect(f.channel.start(modelStartParams())).rejects.toMatchObject({
      message: 'TASK_MODEL_STREAM_REFUSED',
      diagnostic: {
        phase: 'response',
        httpStatus: 200,
        responseReason: 'content_type'
      }
    })
  })

  it.each([false, true])(
    'retains a finite missing body reason through late observers with headerless=%s',
    async (headerless) => {
      const f = fixture(
        async () =>
          new Response(null, { headers: headerless ? {} : { 'content-type': 'text/event-stream' } })
      )
      await expect(f.channel.start(modelStartParams())).rejects.toMatchObject({
        diagnostic: { responseReason: 'missing_body' }
      })
      const late = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(late)
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(late.mock.calls[0][0].diagnostic).toMatchObject({ responseReason: 'missing_body' })
    }
  )

  it('rejects malformed gzip during decoded stream reading without producing a model completion', async () => {
    const f = await localResponse({
      encoding: 'gzip',
      bytes: Buffer.from('private invalid gzip secret')
    })
    const params = modelStartParams()
    await f.channel.start(params)
    await expect(f.channel.next({ requestId: params.requestId, sequence: 0 })).rejects.toThrow(
      'TASK_MODEL_STREAM_REFUSED'
    )
  })

  it('charges decoded bytes instead of admitting a small compressed response past the cap', async () => {
    const packet = `:${'a'.repeat(512 * 1024 - 3)}\n\n`
    const body =
      createdModelEvent +
      packet.repeat(Math.ceil(TASK_MODEL_RESPONSE_BYTES / Buffer.byteLength(packet)) + 1)
    expect(compress(body, 'gzip').length).toBeLessThan(TASK_MODEL_RESPONSE_BYTES)
    const f = await localResponse({ encoding: 'gzip', body })
    const params = modelStartParams()
    await f.channel.start(params)
    const draining = async () => {
      for (let sequence = 0; sequence < 128; sequence++) {
        await f.channel.next({ requestId: params.requestId, sequence })
      }
    }
    await expect(draining()).rejects.toThrow('TASK_MODEL_BUDGET_REFUSED')
  })

  it('keeps original cancellation fencing while a decoded gzip stream is pending', async () => {
    const url = await endpoint((response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' })
      response.write(gzipSync(createdModelEvent))
    })
    const f = fixture(async (_input, init) => {
      const actual = await fetch(url, { signal: init?.signal })
      return new Response(actual.body, { status: actual.status, headers: actual.headers })
    })
    const params = modelStartParams()
    await f.channel.start(params)
    const first = await f.channel.next({ requestId: params.requestId, sequence: 0 })
    expect(Buffer.from(first.bodyBase64, 'base64').toString()).toBe(createdModelEvent)
    const pulling = expect(
      f.channel.next({ requestId: params.requestId, sequence: 1 })
    ).rejects.toThrow('TASK_MODEL_REQUEST_ABORTED')
    await f.channel.cancel({ requestId: params.requestId })
    await pulling
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_CHANNEL_UNAVAILABLE'
    )
  })

  it('refuses invalid decoded SSE even when its gzip encoding is admitted', async () => {
    const f = await localResponse({
      encoding: 'gzip',
      body: `${createdModelEvent}data: {"type":"remote.authority"}\n\n`
    })
    const params = modelStartParams()
    await f.channel.start(params)
    await expect(f.channel.next({ requestId: params.requestId, sequence: 0 })).rejects.toThrow(
      'TASK_MODEL_STREAM_REFUSED'
    )
  })
})
