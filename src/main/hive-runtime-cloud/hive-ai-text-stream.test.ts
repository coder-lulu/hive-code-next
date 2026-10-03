import { afterEach, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { readHiveAiTextStream } from './hive-ai-text-stream'
import { HiveAiTextStreamClient } from './hive-ai-text-stream-client'
import { grantCommand } from '../../shared/hive-ai-text-grant.test-fixture'
import { controlOwner } from '../../shared/hive-ai-text-control.test-fixture'
const requestId = grantCommand.request.requestId
const text = { type: 'text', requestId, sequence: 1, text: '你好🐝' }
const result = {
  type: 'result',
  requestId,
  sequence: 2,
  state: 'COMPLETED',
  replay: false,
  execution: {
    status: 'COMPLETED',
    reason: 'TERMINAL',
    gatewayRequestId: 'a'.repeat(24),
    usage: null
  }
}
const wire = (...events: unknown[]) =>
  events.map((event) => `data:${JSON.stringify(event)}\n\n`).join('')
function body(value: string, split = 0) {
  const bytes = new TextEncoder().encode(value)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (split) {
        for (let offset = 0; offset < bytes.length; offset += split) {
          controller.enqueue(bytes.slice(offset, offset + split))
        }
      } else {
        controller.enqueue(bytes)
      }
      controller.close()
    }
  })
}
function read(value: string, options = {}) {
  return readHiveAiTextStream({
    body: body(value),
    requestId,
    signal: new AbortController().signal,
    assertCurrent: () => {},
    onText: () => {},
    ...options
  })
}
afterEach(() => vi.useRealTimers())
it.each([1, 2, 3, 17, 10000])('preserves split UTF-8 and frames (%i bytes)', async (split) => {
  const onText = vi.fn()
  expect(await read(wire(text, result), { body: body(wire(text, result), split), onText })).toEqual(
    result
  )
  expect(onText).toHaveBeenCalledExactlyOnceWith('你好🐝')
})
it.each([
  '',
  wire(text),
  wire(result),
  wire({ ...text, sequence: 2 }, result),
  wire({ ...text, requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, result),
  wire(text, { ...result, replay: true }),
  wire(text, result, result),
  `${wire(text, result)}data:`,
  wire({ ...text, extra: 'secret' }, result),
  wire({ ...text, text: '\ud800' }, result),
  wire(text, result).replace('"type":"text"', '"type":"text","type":"text"'),
  `data:${'a'.repeat(524289)}`
])('rejects incomplete or ambiguous stream %# without exposing content', async (value) => {
  await expect(read(value)).rejects.toThrow(/^hive_ai_stream_unavailable$/)
})
it('returns replay metadata without fabricating text', async () => {
  const onText = vi.fn()
  expect(await read(wire({ ...result, sequence: 1, replay: true }), { onText })).toMatchObject({
    replay: true
  })
  expect(onText).not.toHaveBeenCalled()
})
it('rejects invalid UTF-8 rather than replacing bytes', async () => {
  await expect(
    read('', {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0xff]))
          controller.close()
        }
      })
    })
  ).rejects.toThrow('hive_ai_stream_unavailable')
})
it('cancels a stalled reader and never reports completion', async () => {
  const abort = new AbortController(),
    cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({ cancel })
  const checked = expect(read('', { body: stream, signal: abort.signal })).rejects.toThrow(
    'hive_ai_stream_unavailable'
  )
  abort.abort()
  await checked
  expect(cancel).toHaveBeenCalledOnce()
})
it('stops synchronously when the text sink revokes the current identity', async () => {
  let current = true
  await expect(
    read(wire(text, result), {
      onText: () => {
        current = false
      },
      assertCurrent: () => {
        if (!current) {
          throw new Error('private-canary')
        }
      }
    })
  ).rejects.toThrow(/^hive_ai_stream_unavailable$/)
})

function input() {
  const pair = generateKeyPairSync('ed25519')
  const { messages: _, ...content } = grantCommand.request
  return {
    command: grantCommand,
    owner: controlOwner,
    authorityId: 'authority',
    accessToken: 'private-token',
    identity: {
      schemaVersion: 1 as const,
      runtimeInstanceId: grantCommand.runtime.runtimeInstanceId,
      createdAt: 1,
      privateKeyPkcs8: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      publicKey: pair.publicKey
        .export({ type: 'spki', format: 'der' })
        .subarray(-32)
        .toString('base64url')
    },
    grant: {
      signature: 'A'.repeat(86),
      claims: {
        domain: 'hive-ai-text-grant/v1',
        issuer: 'hive-ai-authority',
        audience: 'hive-ai-edge',
        authorityId: 'authority',
        algorithm: 'Ed25519',
        grant: {
          grantId: requestId,
          owner: controlOwner,
          nonce: requestId,
          eligibilityRevision: 1,
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          binding: {
            ...content,
            ...grantCommand.pack,
            runtime: grantCommand.runtime,
            projectScope: grantCommand.projectScope,
            credentialFence: 'c'.repeat(64),
            requestHash: 'd'.repeat(64),
            gatewayRevision: 1
          }
        }
      }
    },
    signal: new AbortController().signal,
    assertCurrent: () => {},
    onText: vi.fn()
  }
}
it('posts exactly one fixed-path signed request and returns only a validated result', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(wire(text, result), {
        headers: { 'content-type': 'text/event-stream;charset=UTF-8' }
      })
  )
  const command = input()
  expect(await new HiveAiTextStreamClient('https://cloud.test', fetcher).execute(command)).toEqual(
    result
  )
  expect(fetcher).toHaveBeenCalledOnce()
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://cloud.test/hive/v1/ai/inferences')
  expect(init.redirect).toBe('error')
  expect(init.credentials).toBe('omit')
  expect(JSON.parse(init.body as string)).toEqual(grantCommand)
  const headers = init.headers as Record<string, string>
  expect(JSON.parse(Buffer.from(headers['X-Hive-AI-Proof'], 'base64url').toString()).path).toBe(
    '/hive/v1/ai/inferences'
  )
  expect(JSON.parse(Buffer.from(headers['X-Hive-AI-Grant'], 'base64url').toString())).toEqual(
    command.grant
  )
})
it.each([302, 401, 403, 409, 503])(
  'does not retry HTTP %i or expose its response',
  async (status) => {
    const fetcher = vi.fn(async () => new Response('private-canary', { status }))
    await expect(
      new HiveAiTextStreamClient('https://cloud.test', fetcher).execute(input())
    ).rejects.toThrow(/^hive_ai_stream_unavailable$/)
    expect(fetcher).toHaveBeenCalledOnce()
  }
)
it('discards headers that arrive after the deadline even if fetch ignores abort', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(async () => {
    await vi.advanceTimersByTimeAsync(15001)
    return new Response(wire(text, result), { headers: { 'content-type': 'text/event-stream' } })
  })
  const command = input()
  await expect(
    new HiveAiTextStreamClient('https://cloud.test', fetcher).execute(command)
  ).rejects.toThrow('hive_ai_stream_unavailable')
  expect(command.onText).not.toHaveBeenCalled()
})
it('aborts an idle body without another request', async () => {
  vi.useFakeTimers()
  const cancel = vi.fn()
  const fetcher = vi.fn(
    async () =>
      new Response(new ReadableStream({ cancel }), {
        headers: { 'content-type': 'text/event-stream' }
      })
  )
  const checked = expect(
    new HiveAiTextStreamClient('https://cloud.test', fetcher).execute(input())
  ).rejects.toThrow('hive_ai_stream_unavailable')
  await vi.advanceTimersByTimeAsync(60001)
  await checked
  expect(cancel).toHaveBeenCalledOnce()
  expect(fetcher).toHaveBeenCalledOnce()
})

it('ends header wait on timeout even when fetch never resolves', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(() => new Promise<Response>(() => {}))
  const checked = expect(
    new HiveAiTextStreamClient('https://cloud.test', fetcher).execute(input())
  ).rejects.toThrow('hive_ai_stream_unavailable')
  await vi.advanceTimersByTimeAsync(15001)
  await checked
  expect(fetcher).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
it('revocation stops a silent stream without waiting for the idle deadline', async () => {
  vi.useFakeTimers()
  let current = true
  const cancel = vi.fn()
  const fetcher = vi.fn(
    async () =>
      new Response(new ReadableStream({ cancel }), {
        headers: { 'content-type': 'text/event-stream' }
      })
  )
  const checked = expect(
    new HiveAiTextStreamClient('https://cloud.test', fetcher).execute({
      ...input(),
      assertCurrent: () => {
        if (!current) {
          throw new Error('revoked')
        }
      }
    })
  ).rejects.toThrow('hive_ai_stream_unavailable')
  await vi.advanceTimersByTimeAsync(1)
  current = false
  await vi.advanceTimersByTimeAsync(1000)
  await checked
  expect(cancel).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
