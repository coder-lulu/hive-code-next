import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  completedModelEvent,
  createdModelEvent,
  finishModelRequest,
  modelBrokerFixture,
  modelRequestBody,
  modelResponse,
  modelStartParams
} from './task-model-broker.test-fixture'
import { TASK_MODEL_REQUEST_LIMIT, TASK_MODEL_RESPONSE_BYTES } from './task-model-channel-protocol'

const fixtures: ReturnType<typeof modelBrokerFixture>[] = []
function fixture(overrides: Parameters<typeof modelBrokerFixture>[0] = {}) {
  const result = modelBrokerFixture(overrides)
  fixtures.push(result)
  return result
}
afterEach(async () => {
  for (const item of fixtures.splice(0)) {
    await item.channel.close()
  }
})

describe('host-owned bounded task model broker', () => {
  it('admits one active client stream per selected account across task channels', async () => {
    const first = fixture()
    const firstParams = modelStartParams()
    await first.channel.start(firstParams)
    const second = fixture()
    await expect(second.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_ACCOUNT_BUSY'
    )
    expect(second.readAuth).not.toHaveBeenCalled()
    expect(second.request).not.toHaveBeenCalled()
    expect(await finishModelRequest(first.channel, firstParams.requestId)).toBe(
      createdModelEvent + completedModelEvent
    )
    const nextTask = fixture()
    await expect(nextTask.channel.start(modelStartParams())).resolves.toEqual({
      status: 200,
      contentType: 'text/event-stream'
    })
  })
  it('reserves before authentication/dispatch and supplies only fixed Host routing and credentials', async () => {
    const order: string[] = []
    const f = fixture({
      reserveDispatch: async () => {
        order.push('reserved')
      }
    })
    f.readAuth.mockImplementation(async () => {
      order.push('auth')
      return { Authorization: 'Bearer offline_fixture', 'ChatGPT-Account-Id': 'fixture-account' }
    })
    f.request.mockImplementation(async () => {
      order.push('dispatch')
      return modelResponse().reply
    })
    const params = modelStartParams({
      ...modelRequestBody,
      prompt_cache_key: 'guest-id',
      client_metadata: { session_id: 'guest-id' }
    })
    await f.channel.start(params)
    expect(order).toEqual(['reserved', 'auth', 'dispatch'])
    expect(f.readAuth).toHaveBeenCalledWith(
      { codexHomePath: f.scope.codexHome },
      expect.any(AbortSignal)
    )
    const [url, init] = f.request.mock.calls[0]
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit' })
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer offline_fixture')
    expect(headers.get('chatgpt-account-id')).toBe('fixture-account')
    expect(headers.get('x-client-request-id')).toBe(params.requestId)
    expect(headers.get('session-id')).toBe(headers.get('thread-id'))
    expect(headers.get('session-id')).not.toBe('guest-id')
    expect(headers.has('x-openai-internal-codex-responses-lite')).toBe(false)
    expect(JSON.parse(String(init?.body))).toEqual(modelRequestBody)
    expect(f.assertCurrent).toHaveBeenCalledWith(Object.freeze({ ...f.scope }))
  })

  it('snapshots selected scope and deadline and refuses scope without a proven explicit home', async () => {
    const f = fixture()
    const original = { ...f.scope }
    f.scope.codexHome = 'changed'
    f.scope.providerAccountId = 'other-account'
    f.options.deadline = Date.now() - 1
    f.readAuth.mockResolvedValue({
      Authorization: 'Bearer offline_fixture',
      'ChatGPT-Account-Id': 'fixture-account'
    })
    await f.channel.start(modelStartParams())
    expect(f.readAuth).toHaveBeenCalledWith(
      { codexHomePath: original.codexHome },
      expect.any(AbortSignal)
    )
    expect(f.assertCurrent).toHaveBeenCalledWith(original)
    expect(() => modelBrokerFixture({ authScope: { ...original, codexHome: 'relative' } })).toThrow(
      'TASK_MODEL_AUTH_SCOPE_UNAVAILABLE'
    )
  })

  it('pulls upstream only for demand and emits complete validated events in sequence', async () => {
    const response = modelResponse()
    const f = fixture({ request: async () => response.reply })
    const params = modelStartParams()
    await expect(f.channel.start(params)).resolves.toEqual({
      status: 200,
      contentType: 'text/event-stream'
    })
    expect(response.pull).not.toHaveBeenCalled()
    const first = await f.channel.next({ requestId: params.requestId, sequence: 0 })
    expect(first.done).toBe(false)
    expect(Buffer.from(first.bodyBase64, 'base64').toString()).toBe(createdModelEvent)
    const final = await f.channel.next({ requestId: params.requestId, sequence: 1 })
    expect(final.done).toBe(true)
    expect(Buffer.from(final.bodyBase64, 'base64').toString()).toBe(completedModelEvent)
    expect(response.cancel).toHaveBeenCalledTimes(1)
    await expect(f.channel.cancel({ requestId: params.requestId })).resolves.toEqual({
      cancelled: true
    })
  })

  it.each([
    { requestId: 'not-a-uuid', bodyBase64: 'e30=' },
    { requestId: randomUUID(), bodyBase64: 'e30' },
    { requestId: randomUUID(), bodyBase64: '/w==' },
    { requestId: randomUUID(), bodyBase64: 'e30=', account: 'override' },
    modelStartParams({ ...modelRequestBody, model: 'unapproved' }),
    modelStartParams({ ...modelRequestBody, tools: [{ type: 'web_search' }] })
  ])('refuses guest authority/body/protocol changes before any dispatch %#', async (params) => {
    const f = fixture()
    await expect(f.channel.start(params)).rejects.toThrow(/^TASK_MODEL_/)
    expect(f.reserveDispatch).not.toHaveBeenCalled()
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_CHANNEL_UNAVAILABLE'
    )
  })

  it('refuses overlap and replay without allocating a second upstream request', async () => {
    const f = fixture()
    const params = modelStartParams()
    await f.channel.start(params)
    await expect(f.channel.start(modelStartParams())).rejects.toThrow('TASK_MODEL_BUDGET_REFUSED')
    expect(f.request).toHaveBeenCalledTimes(1)
    const replay = fixture()
    await replay.channel.start(params)
    await finishModelRequest(replay.channel, params.requestId)
    await expect(replay.channel.start(params)).rejects.toThrow('TASK_MODEL_BUDGET_REFUSED')
    expect(replay.request).toHaveBeenCalledTimes(1)
  })

  it('enforces the cumulative dispatch cap across completed requests', async () => {
    const f = fixture()
    for (let count = 0; count < TASK_MODEL_REQUEST_LIMIT; count++) {
      const params = modelStartParams()
      await f.channel.start(params)
      expect(await finishModelRequest(f.channel, params.requestId)).toBe(
        createdModelEvent + completedModelEvent
      )
    }
    await expect(f.channel.start(modelStartParams())).rejects.toThrow('TASK_MODEL_BUDGET_REFUSED')
    expect(f.reserveDispatch).toHaveBeenCalledTimes(TASK_MODEL_REQUEST_LIMIT)
    expect(f.request).toHaveBeenCalledTimes(TASK_MODEL_REQUEST_LIMIT)
  })

  it('rejects wrong sequence and terminates the entire channel', async () => {
    const f = fixture()
    const failure = vi.fn()
    f.channel.onFailure(failure)
    const params = modelStartParams()
    await f.channel.start(params)
    await expect(f.channel.next({ requestId: params.requestId, sequence: 1 })).rejects.toThrow(
      'TASK_MODEL_REQUEST_REFUSED'
    )
    await expect(f.channel.next({ requestId: params.requestId, sequence: 0 })).rejects.toThrow(
      'TASK_MODEL_CHANNEL_UNAVAILABLE'
    )
    expect(failure).toHaveBeenCalledTimes(1)
  })

  it('requires completed response proof and never returns an invalid event', async () => {
    const f = fixture({
      request: async () =>
        modelResponse([createdModelEvent, 'data: {"type":"remote.authority"}\n\n']).reply
    })
    const params = modelStartParams()
    await f.channel.start(params)
    await f.channel.next({ requestId: params.requestId, sequence: 0 })
    await expect(f.channel.next({ requestId: params.requestId, sequence: 1 })).rejects.toThrow(
      'TASK_MODEL_STREAM_REFUSED'
    )
    const incomplete = fixture({ request: async () => modelResponse([createdModelEvent]).reply })
    const missing = modelStartParams()
    await incomplete.channel.start(missing)
    await incomplete.channel.next({ requestId: missing.requestId, sequence: 0 })
    await expect(
      incomplete.channel.next({ requestId: missing.requestId, sequence: 1 })
    ).rejects.toThrow('TASK_MODEL_STREAM_REFUSED')
  })

  it('charges raw response bytes including comments before exceeding the cumulative cap', async () => {
    const packet = `:${'a'.repeat(512 * 1024 - 3)}\n\n`
    const count = Math.ceil(TASK_MODEL_RESPONSE_BYTES / Buffer.byteLength(packet)) + 1
    const f = fixture({
      request: async () =>
        modelResponse([createdModelEvent, ...Array.from({ length: count }, () => packet)]).reply
    })
    const params = modelStartParams()
    await f.channel.start(params)
    await f.channel.next({ requestId: params.requestId, sequence: 0 })
    await expect(f.channel.next({ requestId: params.requestId, sequence: 1 })).rejects.toThrow(
      'TASK_MODEL_BUDGET_REFUSED'
    )
  })
})
