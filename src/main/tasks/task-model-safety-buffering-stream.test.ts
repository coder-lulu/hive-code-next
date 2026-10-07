import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTaskModelStreamFetchFixture } from './task-model-stream-fetch.test-fixture'
import {
  createdModelEvent,
  completedModelEvent,
  finishModelRequest,
  modelEvent
} from './task-model-broker.test-fixture'
import { readPersistedTestAgentSessionStore } from '../runtime/agent-session-record-store-test-harness'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import type { TaskFailureError } from './task-failure-diagnostic'

const buffering = { use_cases: ['synthetic'], reasons: ['synthetic'], retry_model: null }
let directory: string
const fixtures: Awaited<ReturnType<typeof createTaskModelStreamFetchFixture>>[] = []
beforeEach(async () => {
  const root = resolve(
    'logs/paperclip-development/p3/task-native-acceptance-contract/safety-writer/tmp'
  )
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'safety-'))
  vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW)
})
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async ({ channel, server }) => {
      await channel.close()
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    })
  )
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})
async function fixture(
  body: string | Buffer,
  options: Parameters<typeof createTaskModelStreamFetchFixture>[2] = {}
) {
  const result = await createTaskModelStreamFetchFixture(directory, body, options)
  fixtures.push(result)
  return result
}
const metadata = {
  type: 'safety_buffering',
  use_cases: ['nested'],
  reasons: ['nested'],
  retry_model: null
}

describe('pinned safety buffering through original Task and global Fetch', () => {
  it.each([
    { label: 'absent marker', body: createdModelEvent + completedModelEvent },
    ...[false, null, buffering, { use_cases: [], reasons: [] }].map((value, index) => ({
      label: `created marker case ${index}`,
      body:
        modelEvent('response.created', {
          response: { id: 'resp-fixture' },
          safety_buffering: value
        }) + completedModelEvent
    })),
    {
      label: 'output signal before delta',
      body:
        createdModelEvent +
        modelEvent('response.output_text.delta', {
          delta: 'Synthetic 中文🙂',
          safety_buffering: buffering
        }) +
        completedModelEvent
    },
    {
      label: 'completed signal',
      body:
        createdModelEvent +
        modelEvent('response.completed', {
          response: { id: 'resp-fixture' },
          safety_buffering: buffering
        })
    },
    {
      label: 'nested fallback',
      body: createdModelEvent + modelEvent('response.metadata', { metadata }) + completedModelEvent
    },
    ...[false, null, buffering].map((value, index) => ({
      label: `top-level precedence case ${index}`,
      body:
        createdModelEvent +
        modelEvent('response.metadata', { safety_buffering: value, metadata }) +
        completedModelEvent
    }))
  ])(
    'preserves valid $label bytes and original state without manufacturing an outcome',
    async ({ body }) => {
      const f = await fixture(body)
      const before = f.owner.store.tasks.get(f.owner.command)!
      const session = f.owner.store.getRecord(f.owner.binding.sessionId)
      const failed = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(failed)
      expect(await f.channel.start(f.params)).toEqual({
        status: 200,
        contentType: 'text/event-stream'
      })
      expect(await finishModelRequest(f.channel, f.params.requestId)).toBe(body)
      await f.channel.close()
      const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
      expect(task).toMatchObject({
        status: before.status,
        dispatch: before.dispatch,
        result: null,
        cancellationKey: before.cancellationKey,
        structuredBinding: before.structuredBinding,
        modelDispatchAttempts: 1
      })
      expect(task.events).toEqual(before.events)
      expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
      expect(f.request).toHaveBeenCalledOnce()
      expect(failed).not.toHaveBeenCalled()
    }
  )

  it('does not forward upstream treatment headers when retry_model is omitted', async () => {
    const body =
      createdModelEvent +
      modelEvent('response.output_text.delta', {
        delta: '',
        safety_buffering: { use_cases: [], reasons: [] }
      }) +
      completedModelEvent
    const f = await fixture(body, {
      headers: {
        'x-codex-safety-buffering-enabled': 'false',
        'x-codex-safety-buffering-faster-model': 'unapproved'
      }
    })
    expect(await f.channel.start(f.params)).toEqual({
      status: 200,
      contentType: 'text/event-stream'
    })
    expect(await finishModelRequest(f.channel, f.params.requestId)).toBe(body)
  })

  it.each<{
    label: string
    suffix: string
    reason?: string
    location?: string
    streamReason?: string
  }>([
    {
      label: 'unsupported retry model',
      suffix: modelEvent('response.output_text.delta', {
        delta: '',
        safety_buffering: { ...buffering, retry_model: 'body-token-secret' }
      }),
      reason: 'SAFETY_BUFFERING_UNSUPPORTED',
      location: 'safety_buffering'
    },
    {
      label: 'malformed top-level suppresses fallback',
      suffix: modelEvent('response.metadata', { safety_buffering: { use_cases: [] }, metadata }),
      reason: 'REQUIRED_FIELD',
      location: 'safety_buffering'
    },
    {
      label: 'unknown safety key',
      suffix: modelEvent('response.output_text.delta', {
        delta: '',
        safety_buffering: { ...buffering, 'private-key': 'body-token-secret' }
      }),
      reason: 'UNKNOWN_FIELD',
      location: 'safety_buffering'
    },
    {
      label: 'unapproved tool',
      suffix: modelEvent('response.output_item.added', {
        safety_buffering: buffering,
        item: { type: 'function_call', call_id: 'call-fixture', name: 'unapproved', arguments: '' }
      }),
      reason: 'CALL_UNAPPROVED',
      location: 'item'
    },
    {
      label: 'invalid usage',
      suffix: modelEvent('response.completed', {
        safety_buffering: buffering,
        response: {
          id: 'resp-fixture',
          usage: { input_tokens: 1, output_tokens: false, total_tokens: 1 }
        }
      }),
      reason: 'INTEGER',
      location: 'usage'
    },
    {
      label: 'foreign correlation',
      suffix: modelEvent('response.completed', {
        safety_buffering: buffering,
        response: { id: 'foreign' }
      }),
      streamReason: 'response_id'
    },
    {
      label: 'duplicate key',
      suffix:
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"","safety_buffering":{"use_cases":[],"reasons":[],"reasons":[]}}\n\n',
      reason: 'DUPLICATE_KEY',
      location: 'event'
    },
    {
      label: 'prototype key',
      suffix:
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"","safety_buffering":{"use_cases":[],"reasons":[],"__proto__":{}}}\n\n',
      reason: 'PROTOTYPE_KEY',
      location: 'event'
    }
  ])(
    'refuses $label with original first-error identity and safe persisted diagnostics',
    async ({ suffix, reason, location, streamReason }) => {
      const f = await fixture(createdModelEvent + suffix + completedModelEvent)
      const before = f.owner.store.tasks.get(f.owner.command)!
      const session = f.owner.store.getRecord(f.owner.binding.sessionId)
      const failed = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(failed)
      await f.channel.start(f.params)
      await expect(finishModelRequest(f.channel, f.params.requestId)).rejects.toMatchObject({
        diagnostic: {
          streamReason: streamReason ?? 'policy',
          ...(reason ? { policyReason: reason, policyLocation: location } : {})
        }
      })
      await f.channel.close()
      const late = vi.fn<(failure: TaskFailureError) => void>()
      f.channel.onFailure(late)
      await new Promise<void>((done) => queueMicrotask(done))
      expect(late.mock.calls[0][0]).toBe(failed.mock.calls[0][0])
      const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
      expect(task).toMatchObject({
        status: before.status,
        dispatch: before.dispatch,
        result: null,
        cancellationKey: before.cancellationKey,
        structuredBinding: before.structuredBinding,
        modelDispatchAttempts: 1
      })
      expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
      expect(JSON.stringify(task.events)).not.toMatch(/private-key|body-token-secret|unapproved/)
      expect(f.request).toHaveBeenCalledOnce()
    }
  )

  it('retains original cancellation fencing while a valid safety signal is pending', async () => {
    const body = modelEvent('response.created', {
      response: { id: 'resp-fixture' },
      safety_buffering: buffering
    })
    const f = await fixture(body, { holdOpen: true })
    const session = f.owner.store.getRecord(f.owner.binding.sessionId)
    await f.channel.start(f.params)
    const first = await f.channel.next({ requestId: f.params.requestId, sequence: 0 })
    expect(Buffer.from(first.bodyBase64, 'base64').toString()).toBe(body)
    const pending = expect(
      f.channel.next({ requestId: f.params.requestId, sequence: 1 })
    ).rejects.toThrow('TASK_MODEL_REQUEST_ABORTED')
    await f.channel.cancel({ requestId: f.params.requestId })
    await pending
    expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
    const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
    expect(task.result).toBeNull()
    expect(task.modelDispatchAttempts).toBe(1)
  })
})
