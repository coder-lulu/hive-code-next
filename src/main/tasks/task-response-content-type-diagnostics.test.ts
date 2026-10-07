import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTaskCodexModelChannel } from './task-codex-model-channel'
import { createTaskModelDispatchFixture } from './task-model-dispatch.test-fixture'
import { modelStartParams } from './task-model-broker.test-fixture'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { taskFailure, taskFailureSummary, type TaskFailureError } from './task-failure-diagnostic'
import { readPersistedTestAgentSessionStore } from '../runtime/agent-session-record-store-test-harness'
import { TASK_TEST_NOW } from './task-execution.test-fixture'

let directory: string
const servers: Server[] = []
const channels: ReturnType<typeof createTaskCodexModelChannel>[] = []
beforeEach(async () => {
  const root = resolve('logs/paperclip-development/p3/task-codex-headerless-sse/writer/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'metadata-'))
  vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW)
})
afterEach(async () => {
  await Promise.all(channels.splice(0).map((channel) => channel.close()))
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    })
  )
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})
async function refusedResponse(contentType: string | string[] | null) {
  const server = createServer((_request, response) => {
    if (contentType !== null) {
      response.setHeader('content-type', contentType)
    }
    response.writeHead(200)
    response.end('Synthetic unread body marker: not identified by header metadata')
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Local test server unavailable')
  }
  const owner = await createTaskModelDispatchFixture(directory)
  const providerAccountId = 'offline-provider'
  let readerCalls = () => -1
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const actual = await fetch(`http://127.0.0.1:${address.port}`, { signal: init?.signal })
    // Preserve actual Fetch metadata/body at the existing seam without widening the provider URL guard.
    const reply = new Response(actual.body, { status: actual.status, headers: actual.headers })
    const bodyReader = vi.spyOn(reply.body!, 'getReader')
    readerCalls = () => bodyReader.mock.calls.length
    return reply
  })
  const channel = createTaskCodexModelChannel({
    store: owner.store,
    binding: owner.binding,
    account: {
      accountId: 'offline-managed-row',
      codexHome: owner.binding.accountHome.path,
      providerAccountId,
      assertCurrent: owner.validate,
      assertMetadataCurrent: owner.validate
    },
    deadline: TASK_TEST_NOW + 120_000,
    assertCurrent: owner.validate,
    readAuth: async () => ({
      Authorization: 'Bearer offline_synthetic',
      'ChatGPT-Account-Id': providerAccountId
    }),
    request
  })
  channels.push(channel)
  const profile = taskDockerModelProfile()
  const params = modelStartParams({
    model: profile.model,
    input: [
      { type: 'additional_tools', role: 'developer', tools: profile.approvedTools },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Synthetic request' }]
      }
    ],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    reasoning: { effort: 'low', context: 'all_turns' },
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content']
  })
  return { owner, channel, params, request, readerCalls: () => readerCalls() }
}
describe('finite refused Content-Type header metadata on the original Task', () => {
  it('requires strict body validation after an absent header instead of inventing MIME or body evidence', async () => {
    const f = await refusedResponse(null)
    await expect(f.channel.start(f.params)).resolves.toMatchObject({ status: 200 })
    await expect(
      f.channel.next({ requestId: f.params.requestId, sequence: 0 })
    ).rejects.toMatchObject({
      diagnostic: { phase: 'stream', code: 'TASK_MODEL_STREAM_REFUSED', httpStatus: 200 }
    })
    await f.channel.close()
    const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
    expect(task.events.at(-1)?.summary).toBe(
      'Task model failure: {"phase":"stream","category":"protocol","code":"TASK_MODEL_STREAM_REFUSED","httpStatus":200,"streamReason":"terminal"}'
    )
    expect(f.readerCalls()).toBe(1)
    expect(task.result).toBeNull()
    expect(task.modelDispatchAttempts).toBe(1)
  })
  it.each([
    ['empty', '', 'empty'],
    ['oversized', `application/${'a'.repeat(129)}`, 'over_limit'],
    ['JSON', 'application/json; private="https://private.invalid/?token=token-secret"', 'json'],
    ['HTML', 'TEXT/HTML; charset=utf-8', 'html'],
    ['text', 'text/plain; token=token-secret', 'text'],
    ['other', 'application/octet-stream', 'other'],
    ['malformed essence', 'missing-slash-token-secret', 'malformed'],
    ['duplicate combined', ['text/event-stream', 'text/event-stream'], 'malformed'],
    ['unsupported SSE charset', 'text/event-stream; charset=iso-8859-1', 'sse_parameters'],
    [
      'unsupported SSE parameter',
      'text/event-stream; private="https://private.invalid/?token=token-secret"',
      'sse_parameters'
    ],
    ['duplicate charset', 'text/event-stream; charset=utf-8; charset=utf-8', 'sse_parameters']
  ] as const)(
    'keeps %s metadata finite while refusing and never identifying the unread body',
    async (_label, header, kind) => {
      const f = await refusedResponse(
        header === null || typeof header === 'string' ? header : [...header]
      )
      const before = f.owner.store.tasks.get(f.owner.command)!
      const session = f.owner.store.getRecord(f.owner.binding.sessionId)
      const first = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(first)
      await expect(f.channel.start(f.params)).rejects.toMatchObject({
        diagnostic: {
          phase: 'response',
          category: 'protocol',
          code: 'TASK_MODEL_STREAM_REFUSED',
          httpStatus: 200,
          responseReason: 'content_type'
        }
      })
      await f.channel.close()
      const late = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(late)
      await new Promise<void>((done) => queueMicrotask(done))
      expect(late.mock.calls[0][0]).toBe(first.mock.calls[0][0])
      const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
      expect(
        task.events.filter((event) => event.summary?.startsWith('Task model failure:'))
      ).toHaveLength(1)
      expect(task.events.at(-1)?.summary).toBe(
        `Task model failure: ${JSON.stringify({
          phase: 'response',
          category: 'protocol',
          code: 'TASK_MODEL_STREAM_REFUSED',
          httpStatus: 200,
          responseReason: 'content_type',
          contentTypeKind: kind
        })}`
      )
      expect(JSON.stringify(task.events)).not.toMatch(
        /token-secret|private\.invalid|unread body marker/
      )
      expect(f.readerCalls()).toBe(0)
      expect(f.request).toHaveBeenCalledTimes(1)
      expect(task.modelDispatchAttempts).toBe(1)
      expect(task).toMatchObject({
        status: before.status,
        dispatch: before.dispatch,
        result: before.result,
        cancellationKey: before.cancellationKey,
        structuredBinding: before.structuredBinding,
        workspace: before.workspace
      })
      expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
    }
  )
  it('keeps the first trusted header classification through later cleanup reasons', () => {
    const make = (...args: unknown[]): TaskFailureError =>
      Reflect.apply(taskFailure, undefined, args)
    const first = make(
      undefined,
      'response',
      'TASK_MODEL_STREAM_REFUSED',
      200,
      'content_type',
      'json'
    )
    expect(first.diagnostic).toMatchObject({ contentTypeKind: 'json' })
    expect(make(first, 'response', 'TASK_MODEL_STREAM_REFUSED', 200, 'content_type', 'html')).toBe(
      first
    )
  })
  it('cannot persist a forged classification or raw header prose on the original Task', async () => {
    const owner = await createTaskModelDispatchFixture(directory)
    const raw = 'application/private-token-secret; route="https://private.invalid/token-secret"'
    const getter = vi.fn(() => raw)
    const forged = Object.defineProperty(
      { code: 'TASK_MODEL_STREAM_REFUSED', message: raw },
      'contentTypeKind',
      { get: getter }
    )
    const failure: TaskFailureError = Reflect.apply(taskFailure, undefined, [
      forged,
      'response',
      'TASK_MODEL_STREAM_REFUSED',
      200,
      'content_type',
      raw
    ])
    await owner.store.tasks.recordModelFailure(owner.task, failure, TASK_TEST_NOW)
    const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[owner.key]
    expect(task.events.at(-1)?.summary).toBe(
      'Task model failure: {"phase":"response","category":"protocol","code":"TASK_MODEL_STREAM_REFUSED","httpStatus":200,"responseReason":"content_type"}'
    )
    expect(JSON.stringify(task.events)).not.toMatch(/token-secret|private\.invalid|contentTypeKind/)
    expect(getter).not.toHaveBeenCalled()
    expect(task.result).toBeNull()
    expect(task.status).toBe(owner.task.status)
  })
  it('drops forged/raw labels without fabricating missing evidence or widening the valid phase/code/reason', () => {
    const make = (...args: unknown[]): TaskFailureError =>
      Reflect.apply(taskFailure, undefined, args)
    for (const kind of [
      'https://private.invalid/token-secret',
      'json_token-secret',
      Object('json')
    ]) {
      const failure = make(
        { contentTypeKind: kind },
        'response',
        'TASK_MODEL_STREAM_REFUSED',
        200,
        'content_type',
        kind
      )
      expect(failure.diagnostic).not.toHaveProperty('contentTypeKind')
      expect(taskFailureSummary('model', failure)).not.toMatch(/token-secret|private\.invalid/)
    }
    const getter = vi.fn(() => 'json')
    const forged = Object.defineProperty({}, 'contentTypeKind', { get: getter })
    expect(
      make(forged, 'response', 'TASK_MODEL_STREAM_REFUSED', 200, 'content_type').diagnostic
    ).not.toHaveProperty('contentTypeKind')
    expect(getter).not.toHaveBeenCalled()
    for (const args of [
      [undefined, 'stream', 'TASK_MODEL_STREAM_REFUSED', 200, 'content_type', 'json'],
      [undefined, 'response', 'TASK_MODEL_STREAM_REFUSED', 429, 'content_type', 'json'],
      [undefined, 'response', 'TASK_MODEL_STREAM_REFUSED', 200, 'content_encoding', 'json'],
      [undefined, 'response', 'TASK_MODEL_UPSTREAM_UNAVAILABLE', 200, 'content_type', 'json'],
      [undefined, 'response', 'TASK_MODEL_STREAM_REFUSED', 200, 'content_type']
    ]) {
      expect(make(...args).diagnostic).not.toHaveProperty('contentTypeKind')
    }
  })
})
