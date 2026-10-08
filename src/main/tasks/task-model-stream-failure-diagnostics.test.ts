import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import type { Server } from 'node:http'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { createTaskCodexModelChannel } from './task-codex-model-channel'
import { createTaskModelDispatchFixture } from './task-model-dispatch.test-fixture'
import { taskDockerModelProfile } from './task-docker-model-profile'
import {
  createdModelEvent,
  completedModelEvent,
  modelEvent,
  finishModelRequest
} from './task-model-broker.test-fixture'
import { taskFailure, taskFailureSummary, type TaskFailureError } from './task-failure-diagnostic'
import { createTaskModelSseReader } from './task-model-sse'
import { deny } from './task-model-policy-json'
import {
  TASK_MODEL_EVENT_BYTES,
  TASK_MODEL_EVENT_LIMIT,
  TASK_MODEL_RESPONSE_BYTES
} from './task-model-channel-protocol'
import { createTaskModelPolicy } from './task-model-policy'
import { addTaskModelPolicyLocation } from './task-model-stream-failure'
import { refusedTaskModelResponseFields } from './task-model-response-field-diagnostics.test-fixture'
import { readPersistedTestAgentSessionStore } from '../runtime/agent-session-record-store-test-harness'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { createTaskModelStreamFetchFixture } from './task-model-stream-fetch.test-fixture'

let directory: string
const servers: Server[] = []
const channels: ReturnType<typeof createTaskCodexModelChannel>[] = []
beforeEach(async () => {
  const root = resolve('logs/paperclip-development/p3/task-response-field-diagnostics/writer/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'stream-reasons-'))
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
  closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})
async function fixture(body: string | Buffer) {
  const result = await createTaskModelStreamFetchFixture(directory, body)
  servers.push(result.server)
  channels.push(result.channel)
  return result
}
const refused = (error: unknown) => taskFailure(error, 'stream', 'TASK_MODEL_STREAM_REFUSED', 200)
const malformedResponseReasons: Record<string, string> = {
  access_programs: 'OBJECT',
  parallel_tool_calls: 'BOOLEAN',
  tool_choice: 'ENUM',
  tools: 'ARRAY',
  max_output_tokens: 'INTEGER',
  max_tool_calls: 'INTEGER',
  reasoning: 'OBJECT',
  store: 'BOOLEAN',
  text: 'OBJECT',
  top_logprobs: 'INTEGER',
  truncation: 'ENUM'
}
describe('actual finite stream guard and policy producer diagnostics', () => {
  it.each<{
    label: string
    body: string | Buffer
    reason: string
    policy?: string
    location?: string
    key?: string
  }>([
    {
      label: 'empty response metadata property',
      body:
        modelEvent('response.created', { response: { id: 'resp-fixture', metadata: { '': 1 } } }) +
        completedModelEvent,
      reason: 'policy',
      policy: 'UNKNOWN_FIELD',
      location: 'response_metadata',
      key: 'other'
    },
    ...['metadata', 'incomplete_details'].flatMap((container) =>
      ['instructions', 'private-secret'].map((key) => ({
        label: `unknown ${container} ${key} field`,
        body: modelEvent('response.created', {
          response: { id: 'resp-fixture', [container]: { [key]: 'body-token-secret' } }
        }),
        reason: 'policy',
        policy: 'UNKNOWN_FIELD',
        location: container === 'metadata' ? 'response_metadata' : 'incomplete_details',
        key: key === 'instructions' ? key : 'other'
      }))
    ),
    ...refusedTaskModelResponseFields.map((key) => ({
      label: `malformed public response ${key} field`,
      body: modelEvent('response.created', {
        response: {
          id: 'resp-fixture',
          [key]: ['prompt_cache_key', 'safety_identifier'].includes(key)
            ? { private: 'body-token-secret' }
            : 'body-token-secret'
        }
      }),
      reason: 'policy',
      policy: malformedResponseReasons[key] ?? 'RESPONSE_CONFIGURATION',
      location:
        key === 'access_programs'
          ? 'response_access_programs'
          : key === 'reasoning'
            ? 'response_reasoning'
            : key === 'text'
              ? 'response_text'
              : 'response',
      key: malformedResponseReasons[key] ? undefined : key
    })),
    { label: 'empty stream', body: '', reason: 'no_events' },
    { label: 'comments only', body: ': ping\n\n', reason: 'no_events' },
    {
      label: 'plain JSON without SSE framing',
      body: '{"private":"body-token-secret"}',
      reason: 'terminal'
    },
    { label: 'HTML field', body: '<html>body-token-secret</html>\n', reason: 'field' },
    { label: 'invalid UTF-8', body: Buffer.from([255]), reason: 'utf8' },
    { label: 'malformed SSE JSON', body: 'data: {"type":}\n\n', reason: 'json' },
    { label: 'invalid type', body: 'data: {"type":"UPPER"}\n\n', reason: 'event_type' },
    { label: 'standard id field', body: 'id: body-token-secret\n\n', reason: 'id_field' },
    {
      label: 'standard retry field',
      body: 'retry: https://private.invalid/token-secret\n\n',
      reason: 'retry_field'
    },
    {
      label: 'unknown field',
      body: 'private-secret: https://private.invalid/token-secret\n\n',
      reason: 'field'
    },
    {
      label: 'duplicate name',
      body: `event: response.created\nevent: private-secret\ndata: {"type":"response.created","response":{"id":"resp-fixture"}}\n\n`,
      reason: 'duplicate_event_name'
    },
    {
      label: 'name mismatch',
      body: `event: private-secret\ndata: {"type":"response.created","response":{"id":"resp-fixture"}}\n\n`,
      reason: 'event_name'
    },
    {
      label: 'correlation mismatch',
      body: createdModelEvent + modelEvent('response.completed', { response: { id: 'other' } }),
      reason: 'response_id'
    },
    {
      label: 'duplicate creation',
      body: createdModelEvent + createdModelEvent,
      reason: 'response_order'
    },
    { label: 'completion before creation', body: completedModelEvent, reason: 'response_order' },
    { label: 'DONE before completion', body: 'data: [DONE]\n\n', reason: 'terminal' },
    { label: 'missing completion', body: createdModelEvent, reason: 'terminal' },
    {
      label: 'event size',
      body: `:${'a'.repeat(TASK_MODEL_EVENT_BYTES)}\n\n`,
      reason: 'event_size'
    },
    { label: 'line limit', body: ':\n'.repeat(129), reason: 'line_limit' },
    {
      label: 'real policy unknown field',
      body: modelEvent('response.created', {
        response: { id: 'resp-fixture' },
        'private-secret': 'body-token-secret'
      }),
      reason: 'policy',
      policy: 'UNKNOWN_FIELD',
      location: 'event',
      key: 'other'
    },
    {
      label: 'real policy required field',
      body: modelEvent('response.created', { response: {} }),
      reason: 'policy',
      policy: 'REQUIRED_FIELD',
      location: 'response'
    },
    {
      label: 'real policy unsupported event',
      body: createdModelEvent + modelEvent('remote.authority'),
      reason: 'policy',
      policy: 'EVENT_UNSUPPORTED',
      location: 'event'
    },
    {
      label: 'malformed safety buffering field',
      body: modelEvent('response.created', {
        response: { id: 'resp-fixture' },
        safety_buffering: 'body-token-secret'
      }),
      reason: 'policy',
      policy: 'OBJECT',
      location: 'safety_buffering'
    },
    {
      label: 'response unknown field',
      body: modelEvent('response.created', {
        response: { id: 'resp-fixture', 'private-secret': 'body-token-secret' }
      }),
      reason: 'policy',
      policy: 'UNKNOWN_FIELD',
      location: 'response',
      key: 'other'
    },
    {
      label: 'usage metadata',
      body: modelEvent('response.created', {
        response: { id: 'resp-fixture', usage_metadata: {} }
      }),
      reason: 'policy',
      policy: 'USAGE_METADATA_UNSUPPORTED',
      location: 'response',
      key: 'usage_metadata'
    },
    {
      label: 'model identity',
      body: modelEvent('response.created', {
        response: { id: 'resp-fixture', model: 'private-model-token-secret' }
      }),
      reason: 'policy',
      policy: 'RESPONSE_IDENTITY',
      location: 'response',
      key: 'model'
    },
    {
      label: 'usage unknown field',
      body: modelEvent('response.created', {
        response: {
          id: 'resp-fixture',
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
            'private-secret': 'body-token-secret'
          }
        }
      }),
      reason: 'policy',
      policy: 'UNKNOWN_FIELD',
      location: 'usage',
      key: 'other'
    },
    {
      label: 'item unknown field',
      body:
        createdModelEvent +
        modelEvent('response.output_item.added', {
          item: {
            type: 'message',
            role: 'assistant',
            content: [],
            'private-secret': 'body-token-secret'
          }
        }),
      reason: 'policy',
      policy: 'UNKNOWN_FIELD',
      location: 'item',
      key: 'other'
    },
    {
      label: 'part unknown field',
      body:
        createdModelEvent +
        modelEvent('response.content_part.added', {
          part: { type: 'output_text', text: 'synthetic', 'private-secret': 'body-token-secret' }
        }),
      reason: 'policy',
      policy: 'UNKNOWN_FIELD',
      location: 'part',
      key: 'other'
    },
    {
      label: 'error unknown field',
      body:
        createdModelEvent +
        modelEvent('error', {
          error: { message: 'synthetic', 'private-secret': 'body-token-secret' }
        }),
      reason: 'policy',
      policy: 'UNKNOWN_FIELD',
      location: 'error',
      key: 'other'
    },
    {
      label: 'headers malformed object',
      body: modelEvent('response.created', { response: { id: 'resp-fixture', headers: [] } }),
      reason: 'policy',
      policy: 'OBJECT',
      location: 'headers'
    }
  ])(
    'persists only the actual $label guard on the original Task',
    async ({ body, reason, policy, location, key }) => {
      const f = await fixture(body)
      const before = f.owner.store.tasks.get(f.owner.command)!
      const session = f.owner.store.getRecord(f.owner.binding.sessionId)
      const failed = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(failed)
      await f.channel.start(f.params)
      const emitted: Buffer[] = []
      await expect(
        (async () => {
          for (let sequence = 0; sequence < 128; sequence++) {
            const value = await f.channel.next({ requestId: f.params.requestId, sequence })
            emitted.push(Buffer.from(value.bodyBase64, 'base64'))
            if (value.done) {
              throw new Error('Invalid synthetic stream completed')
            }
          }
        })()
      ).rejects.toThrow('TASK_MODEL_STREAM_REFUSED')
      expect(['', createdModelEvent]).toContain(Buffer.concat(emitted).toString())
      await f.channel.close()
      const late = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(late)
      await new Promise<void>((done) => queueMicrotask(done))
      expect(late.mock.calls[0][0]).toBe(failed.mock.calls[0][0])
      const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
      const summary = task.events.at(-1)?.summary
      expect(summary).toBe(
        `Task model failure: ${JSON.stringify({
          phase: 'stream',
          category: 'protocol',
          code: 'TASK_MODEL_STREAM_REFUSED',
          httpStatus: 200,
          streamReason: reason,
          ...(policy ? { policyReason: policy } : {}),
          ...(location ? { policyLocation: location } : {}),
          ...(key ? { policyKey: key } : {})
        })}`
      )
      expect(JSON.stringify(task.events)).not.toMatch(
        /private-secret|body-token-secret|private\.invalid/
      )
      expect(task).toMatchObject({
        status: before.status,
        dispatch: before.dispatch,
        result: null,
        cancellationKey: before.cancellationKey,
        structuredBinding: before.structuredBinding,
        workspace: before.workspace,
        modelDispatchAttempts: 1
      })
      expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
      expect(f.request).toHaveBeenCalledOnce()
    }
  )
  it('keeps valid bytes identical and does not manufacture diagnostic or outcome evidence', async () => {
    const body =
      modelEvent('response.created', {
        response: { id: 'resp-fixture', metadata: {}, incomplete_details: null }
      }) +
      modelEvent('response.output_text.delta', { delta: 'Synthetic 中文🙂' }) +
      completedModelEvent
    const f = await fixture(body)
    const before = f.owner.store.tasks.get(f.owner.command)!
    await f.channel.start(f.params)
    expect(await finishModelRequest(f.channel, f.params.requestId)).toBe(body)
    await f.channel.close()
    const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
    expect(task.events).toEqual(before.events)
    expect(task.result).toBeNull()
    expect(task.modelDispatchAttempts).toBe(1)
  })
  it('never promotes a message/property/prototype/getter pretending to be an original producer', () => {
    const getter = vi.fn(() => 'json')
    const errors = [
      Object.assign(new Error('TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD'), {
        streamReason: 'policy',
        policyReason: 'UNKNOWN_FIELD'
      }),
      Object.assign(new Error('https://private.invalid/body-token-secret'), {
        streamReason: 'json',
        policyReason: 'UNKNOWN_FIELD'
      }),
      Object.defineProperty({}, 'streamReason', { get: getter }),
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('private-token-secret')
          }
        }
      )
    ]
    for (const error of errors) {
      const safe = refused(error)
      expect(safe.diagnostic).not.toHaveProperty('streamReason')
      expect(safe.diagnostic).not.toHaveProperty('policyReason')
      expect(safe.diagnostic).not.toHaveProperty('policyLocation')
      expect(safe.diagnostic).not.toHaveProperty('policyKey')
      expect(taskFailureSummary('model', safe)).not.toMatch(/private|token-secret/)
    }
    expect(getter).not.toHaveBeenCalled()
    let raw: unknown
    try {
      deny('UNKNOWN_FIELD:https://private.invalid/body-token-secret')
    } catch (error) {
      raw = error
    }
    expect(refused(raw).diagnostic).not.toHaveProperty('streamReason')
  })
  it('does not label an arbitrary pure policy callback error or overwrite a trusted first failure', () => {
    const reader = createTaskModelSseReader(() => {
      throw new Error('TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD')
    })
    let raw: unknown
    try {
      reader.feed(Buffer.from(createdModelEvent))
    } catch (error) {
      raw = error
    }
    expect(refused(raw).diagnostic).not.toHaveProperty('policyReason')
    const first = refused(raw)
    expect(taskFailure(first, 'stream', 'TASK_MODEL_STREAM_REFUSED', 200)).toBe(first)
  })
  it('rejects fake/raw/out-of-scope locations and keeps the first actual producer and scoped metadata', () => {
    const fake = Object.assign(new Error('TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD'), {
      policyLocation: 'event',
      policyKey: 'safety_buffering'
    })
    addTaskModelPolicyLocation(fake, 'event')
    expect(refused(fake).diagnostic).not.toHaveProperty('policyLocation')
    let raw: unknown
    try {
      deny('UNKNOWN_FIELD', 'safety_buffering')
    } catch (error) {
      raw = error
    }
    Reflect.apply(addTaskModelPolicyLocation, undefined, [
      raw,
      'https://private.invalid/token-secret'
    ])
    const getter = vi.fn(() => 'event')
    Reflect.apply(addTaskModelPolicyLocation, undefined, [
      raw,
      {
        get location() {
          return getter()
        }
      }
    ])
    expect(getter).not.toHaveBeenCalled()
    expect(refused(raw).diagnostic).not.toHaveProperty('policyLocation')
    expect(refused(raw).diagnostic).not.toHaveProperty('policyKey')
    addTaskModelPolicyLocation(raw, 'event')
    const first = refused(raw)
    expect(first.diagnostic).toMatchObject({
      streamReason: 'policy',
      policyReason: 'UNKNOWN_FIELD',
      policyLocation: 'event',
      policyKey: 'safety_buffering'
    })
    expect(taskFailure(first, 'response', 'TASK_MODEL_UPSTREAM_UNAVAILABLE', 500)).toBe(first)
    for (const failure of [
      taskFailure(raw, 'request', 'TASK_MODEL_REQUEST_REFUSED', 200),
      taskFailure(raw, 'stream', 'TASK_MODEL_STREAM_REFUSED'),
      taskFailure(raw, 'stream', 'TASK_MODEL_STREAM_REFUSED', 429)
    ]) {
      expect(failure.diagnostic).not.toHaveProperty('streamReason')
      expect(failure.diagnostic).not.toHaveProperty('policyLocation')
    }
  })
  it.each(['event_limit', 'queue_limit'])(
    'retains the actual %s producer under a valid buffered stream and original Task CAS',
    async (reason) => {
      const policy = createTaskModelPolicy(taskDockerModelProfile())
      const reader = createTaskModelSseReader(policy.event)
      const frame =
        reason === 'event_limit'
          ? modelEvent('response.output_text.delta', { delta: '' })
          : `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'a'.repeat(240) })}\n\n`
      const count =
        reason === 'event_limit'
          ? TASK_MODEL_EVENT_LIMIT
          : Math.floor(
              (TASK_MODEL_RESPONSE_BYTES - Buffer.byteLength(createdModelEvent)) /
                Buffer.byteLength(frame)
            )
      const bytes = Buffer.from(createdModelEvent + frame.repeat(count))
      expect(bytes.byteLength).toBeLessThanOrEqual(TASK_MODEL_RESPONSE_BYTES)
      let raw: unknown
      try {
        reader.feed(bytes)
      } catch (error) {
        raw = error
      }
      const failure = refused(raw)
      expect(failure.diagnostic).toMatchObject({ streamReason: reason })
      const owner = await createTaskModelDispatchFixture(directory)
      await owner.store.tasks.recordModelFailure(owner.task, failure, TASK_TEST_NOW)
      const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[owner.key]
      expect(task.events.at(-1)?.summary).toBe(taskFailureSummary('model', failure))
      expect(task.result).toBeNull()
      expect(task.status).toBe(owner.task.status)
    }
  )
})
