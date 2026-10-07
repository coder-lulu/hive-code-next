import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTaskCodexModelChannel } from './task-codex-model-channel'
import { createTaskModelDispatchFixture } from './task-model-dispatch.test-fixture'
import { taskDockerModelProfile } from './task-docker-model-profile'
import {
  completedModelEvent,
  createdModelEvent,
  modelEvent,
  modelStartParams
} from './task-model-broker.test-fixture'
import {
  TASK_MODEL_EVENT_BYTES,
  TASK_MODEL_RESPONSE_BYTES,
  TASK_MODEL_IDLE_TIMEOUT_MS
} from './task-model-channel-protocol'
import { readPersistedTestAgentSessionStore } from '../runtime/agent-session-record-store-test-harness'
import { taskFailure, type TaskFailureError } from './task-failure-diagnostic'
import { TASK_TEST_NOW } from './task-execution.test-fixture'

let directory: string
const servers: Server[] = []
const channels: ReturnType<typeof createTaskCodexModelChannel>[] = []
beforeEach(async () => {
  const root = resolve('logs/paperclip-development/p3/task-codex-headerless-sse/writer/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'headerless-'))
  vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW)
})
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(channels.splice(0).map((channel) => channel.close()))
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    })
  )
  vi.restoreAllMocks()
  closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})
async function fixture(send: (reply: ServerResponse) => void) {
  const server = createServer((_request, reply) => {
    reply.writeHead(200)
    send(reply)
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Local test endpoint unavailable')
  }
  const owner = await createTaskModelDispatchFixture(directory)
  const accountCurrent = vi.fn(() => undefined)
  const assertCurrent = () => {
    owner.validate()
    owner.store.tasks.assertStructuredBindingCurrent(owner.binding)
    accountCurrent()
  }
  const providerAccountId = 'offline-provider'
  const readAuth = vi.fn(async () => {
    const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[owner.key]
    expect(task.modelDispatchAttempts).toBe(1)
    return { Authorization: 'Bearer offline_synthetic', 'ChatGPT-Account-Id': providerAccountId }
  })
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const actual = await fetch(`http://127.0.0.1:${address.port}`, { signal: init?.signal })
    expect(actual.headers.has('content-type')).toBe(false)
    // Existing decoded-body seam keeps the fixed provider URL guard and original Task transaction.
    return new Response(actual.body, { status: actual.status, headers: actual.headers })
  })
  const channel = createTaskCodexModelChannel({
    store: owner.store,
    binding: owner.binding,
    account: {
      accountId: 'offline-managed-row',
      codexHome: owner.binding.accountHome.path,
      providerAccountId,
      assertCurrent: accountCurrent,
      assertMetadataCurrent: accountCurrent
    },
    deadline: TASK_TEST_NOW + 120_000,
    assertCurrent,
    readAuth,
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
  return { owner, channel, params, request, readAuth, accountCurrent }
}
async function persisted(f: Awaited<ReturnType<typeof fixture>>) {
  return (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
}
describe('headerless pinned Codex HTTP bytes through strict original Task SSE policy', () => {
  it('admits valid fragmented SSE and emits only normalized validated frames with one original debit', async () => {
    let release!: () => void
    const delta = modelEvent('response.output_text.delta', { delta: 'Synthetic 中文🙂' })
    const f = await fixture((reply) => {
      reply.write(createdModelEvent.slice(0, -1))
      release = () => reply.end(`\n${delta}${completedModelEvent}`)
    })
    const before = f.owner.store.tasks.get(f.owner.command)!
    const session = f.owner.store.getRecord(f.owner.binding.sessionId)
    const failure = vi.fn()
    f.channel.onFailure(failure)
    await expect(f.channel.start(f.params)).resolves.toEqual({
      status: 200,
      contentType: 'text/event-stream'
    })
    let delivered = false
    const pulling = f.channel.next({ requestId: f.params.requestId, sequence: 0 }).then((value) => {
      delivered = true
      return value
    })
    await new Promise<void>((done) => setImmediate(done))
    expect(delivered).toBe(false)
    release()
    const chunks: Buffer[] = []
    let next = await pulling
    for (let sequence = 1; ; sequence++) {
      chunks.push(Buffer.from(next.bodyBase64, 'base64'))
      if (next.done) {
        break
      }
      next = await f.channel.next({ requestId: f.params.requestId, sequence })
    }
    expect(Buffer.concat(chunks).toString()).toBe(createdModelEvent + delta + completedModelEvent)
    await f.channel.close()
    const task = await persisted(f)
    expect(task).toMatchObject({
      status: before.status,
      dispatch: before.dispatch,
      result: null,
      cancellationKey: null,
      structuredBinding: before.structuredBinding,
      workspace: before.workspace,
      modelDispatchAttempts: 1
    })
    expect(task.events).toEqual(before.events)
    expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
    expect(f.readAuth).toHaveBeenCalledOnce()
    expect(f.request).toHaveBeenCalledOnce()
    expect(failure).not.toHaveBeenCalled()
  })
  it.each([
    ['invalid UTF-8', Buffer.from([255]), 'TASK_MODEL_STREAM_REFUSED'],
    ['JSON body', Buffer.from('{"private":"body-token-secret"}'), 'TASK_MODEL_STREAM_REFUSED'],
    ['HTML body', Buffer.from('<html>body-token-secret</html>'), 'TASK_MODEL_STREAM_REFUSED'],
    ['empty body', Buffer.alloc(0), 'TASK_MODEL_STREAM_REFUSED'],
    [
      'unterminated event',
      Buffer.from('data: {"type":"response.created","response":{"id":"resp-fixture"}}'),
      'TASK_MODEL_STREAM_REFUSED'
    ],
    [
      'mismatched response',
      Buffer.from(
        createdModelEvent + modelEvent('response.completed', { response: { id: 'other' } })
      ),
      'TASK_MODEL_STREAM_REFUSED'
    ],
    [
      'unknown event',
      Buffer.from(
        createdModelEvent + modelEvent('remote.authority', { token: 'body-token-secret' })
      ),
      'TASK_MODEL_STREAM_REFUSED'
    ],
    [
      'invalid usage',
      Buffer.from(
        createdModelEvent +
          modelEvent('response.completed', {
            response: {
              id: 'resp-fixture',
              usage: { input_tokens: -1, output_tokens: 0, total_tokens: 0 }
            }
          })
      ),
      'TASK_MODEL_STREAM_REFUSED'
    ],
    [
      'oversized event',
      Buffer.from(`:${'a'.repeat(TASK_MODEL_EVENT_BYTES)}\n\n`),
      'TASK_MODEL_STREAM_REFUSED'
    ],
    [
      'oversized response',
      Buffer.from(
        `:${'a'.repeat(512 * 1024 - 3)}\n\n`.repeat(
          Math.ceil(TASK_MODEL_RESPONSE_BYTES / (512 * 1024)) + 1
        )
      ),
      'TASK_MODEL_BUDGET_REFUSED'
    ]
  ])(
    'refuses headerless %s without releasing invalid guest bytes or inventing an outcome',
    async (_label, body, code) => {
      const f = await fixture((reply) => reply.end(body))
      const before = f.owner.store.tasks.get(f.owner.command)!
      const session = f.owner.store.getRecord(f.owner.binding.sessionId)
      const failed = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(failed)
      await expect(f.channel.start(f.params)).resolves.toMatchObject({ status: 200 })
      const emitted: Buffer[] = []
      await expect(
        (async () => {
          for (let sequence = 0; sequence < 128; sequence++) {
            const value = await f.channel.next({ requestId: f.params.requestId, sequence })
            emitted.push(Buffer.from(value.bodyBase64, 'base64'))
            if (value.done) {
              throw new Error('Invalid synthetic body completed')
            }
          }
        })()
      ).rejects.toThrow(String(code))
      const bytes = Buffer.concat(emitted).toString()
      expect(['', createdModelEvent]).toContain(bytes)
      expect(failed.mock.calls[0][0].diagnostic).toMatchObject({
        phase: 'stream',
        code,
        httpStatus: 200
      })
      expect(failed.mock.calls[0][0].diagnostic).not.toHaveProperty('contentTypeKind')
      await f.channel.close()
      const late = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(late)
      await new Promise<void>((done) => queueMicrotask(done))
      expect(late.mock.calls[0][0]).toBe(failed.mock.calls[0][0])
      const task = await persisted(f)
      expect(task).toMatchObject({
        status: before.status,
        dispatch: before.dispatch,
        result: null,
        cancellationKey: before.cancellationKey,
        structuredBinding: before.structuredBinding,
        workspace: before.workspace,
        modelDispatchAttempts: 1
      })
      expect(JSON.stringify(task.events)).not.toMatch(
        /body-token-secret|input_tokens|contentTypeKind/
      )
      expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
      await expect(f.channel.start(f.params)).rejects.toThrow('TASK_MODEL_CHANNEL_UNAVAILABLE')
      expect(f.request).toHaveBeenCalledOnce()
    }
  )
  it('preserves a historical original missing-header failure instead of backfilling it from new stream evidence', async () => {
    const f = await fixture((reply) => reply.end('<html>untrusted synthetic body</html>'))
    const first = taskFailure(
      undefined,
      'response',
      'TASK_MODEL_STREAM_REFUSED',
      200,
      'content_type',
      'missing'
    )
    await f.owner.store.tasks.recordModelFailure(f.owner.task, first, TASK_TEST_NOW)
    const originalSummary = (await persisted(f)).events.at(-1)?.summary
    await f.channel.start(f.params)
    await expect(f.channel.next({ requestId: f.params.requestId, sequence: 0 })).rejects.toThrow(
      'TASK_MODEL_STREAM_REFUSED'
    )
    await f.channel.close()
    expect((await persisted(f)).events.at(-1)?.summary).toBe(originalSummary)
  })
  it('keeps the original cancellation and unresolved stop proof while a headerless response read is pending', async () => {
    const f = await fixture((reply) => reply.write(createdModelEvent))
    const session = f.owner.store.getRecord(f.owner.binding.sessionId)
    await f.channel.start(f.params)
    const first = await f.channel.next({ requestId: f.params.requestId, sequence: 0 })
    expect(Buffer.from(first.bodyBase64, 'base64').toString()).toBe(createdModelEvent)
    const outcome = expect(
      f.channel.next({ requestId: f.params.requestId, sequence: 1 })
    ).rejects.toThrow('TASK_MODEL_REQUEST_ABORTED')
    await f.owner.store.tasks.requestCancellation(
      f.owner.command,
      'cancel:original-offline',
      TASK_TEST_NOW,
      f.owner.validate
    )
    await f.channel.close()
    await outcome
    expect(await persisted(f)).toMatchObject({
      cancellationKey: 'cancel:original-offline',
      result: null,
      modelDispatchAttempts: 1
    })
    expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
  })
  it('retains the idle timeout on a headerless pending body', async () => {
    const f = await fixture((reply) => reply.flushHeaders())
    await f.channel.start(f.params)
    vi.useFakeTimers()
    const outcome = expect(
      f.channel.next({ requestId: f.params.requestId, sequence: 0 })
    ).rejects.toThrow('TASK_MODEL_IDLE_TIMEOUT')
    await vi.advanceTimersByTimeAsync(TASK_MODEL_IDLE_TIMEOUT_MS)
    await outcome
    vi.useRealTimers()
    await f.channel.close()
    expect(await persisted(f)).toMatchObject({ result: null, modelDispatchAttempts: 1 })
  })
})
