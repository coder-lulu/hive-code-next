import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskModelStreamFetchFixture } from './task-model-stream-fetch.test-fixture'
import { finishModelRequest, modelStartParams } from './task-model-broker.test-fixture'
import {
  controlledTaskModelResponseStream,
  controlledTaskModelRequest
} from './task-model-response-envelope.test-fixture'
import { readPersistedTestAgentSessionStore } from '../runtime/agent-session-record-store-test-harness'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskDockerModelProfile } from './task-docker-model-profile'
import * as policies from './task-model-policy'

let directory: string
const fixtures: Awaited<ReturnType<typeof createTaskModelStreamFetchFixture>>[] = []
beforeEach(async () => {
  const root = resolve(
    'logs/paperclip-development/p3/task-codex-response-envelope/response-writer/tmp'
  )
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'envelope-'))
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
  closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})
async function fixture(overrides: Record<string, unknown> = {}) {
  const body = controlledTaskModelResponseStream(overrides)
  const result = await createTaskModelStreamFetchFixture(directory, body)
  fixtures.push(result)
  result.params.bodyBase64 = controlledTaskModelRequest(result.params.bodyBase64)
  return { ...result, body }
}

describe('controlled full public envelope on the original Task/global Fetch', () => {
  it.each([undefined, null, 'additional-tools-fixture'])(
    'reserves and fetches once for accepted optional additional_tools id case %#',
    async (id) => {
      const f = await fixture()
      const before = f.owner.store.tasks.get(f.owner.command)!
      const session = f.owner.store.getRecord(f.owner.binding.sessionId)
      const request: { input: Record<string, unknown>[] } = JSON.parse(
        Buffer.from(f.params.bodyBase64, 'base64').toString()
      )
      if (id !== undefined) {
        request.input[0].id = id
      }
      f.params.bodyBase64 = Buffer.from(JSON.stringify(request)).toString('base64')
      await expect(f.channel.start(f.params)).resolves.toEqual({
        status: 200,
        contentType: 'text/event-stream'
      })
      expect(await finishModelRequest(f.channel, f.params.requestId)).toBe(f.body)
      await f.channel.close()
      const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
      expect(task).toMatchObject({
        status: before.status,
        dispatch: before.dispatch,
        result: null,
        structuredBinding: before.structuredBinding,
        cancellationKey: before.cancellationKey,
        workspace: before.workspace,
        modelDispatchAttempts: 1
      })
      expect(task.events).toEqual(before.events)
      expect(f.request).toHaveBeenCalledOnce()
      expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
    }
  )

  it.each([{ id: '' }, { id: 7 }, { id: 'bad\u0000id' }, { id: 'a'.repeat(161) }, { extra: true }])(
    'rejects malformed id or unknown prefix case %# before original reservation or fetch',
    async (prefix) => {
      const f = await fixture()
      const before = f.owner.store.tasks.get(f.owner.command)!
      const session = f.owner.store.getRecord(f.owner.binding.sessionId)
      const request: { input: Record<string, unknown>[] } = JSON.parse(
        Buffer.from(f.params.bodyBase64, 'base64').toString()
      )
      Object.assign(request.input[0], prefix)
      f.params.bodyBase64 = Buffer.from(JSON.stringify(request)).toString('base64')
      await expect(f.channel.start(f.params)).rejects.toMatchObject({
        diagnostic: { phase: 'request' }
      })
      await f.channel.close()
      const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
      expect(task.modelDispatchAttempts).toBe(before.modelDispatchAttempts)
      expect(task.result).toBeNull()
      expect(task.structuredBinding).toEqual(before.structuredBinding)
      expect(f.request).not.toHaveBeenCalled()
      expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
    }
  )

  it('predeclares the exact lite tool inventory representation without learning subsets', async () => {
    const tools = taskDockerModelProfile().approvedTools
    const f = await fixture({ tools })
    await f.channel.start(f.params)
    expect(await finishModelRequest(f.channel, f.params.requestId)).toBe(f.body)
    await f.channel.close()
    const subsetTools: Record<string, unknown>[] = JSON.parse(JSON.stringify(tools))
    const definitions = subsetTools[0].tools
    if (!Array.isArray(definitions) || definitions.length < 2) {
      throw new Error('The pinned namespace fixture requires multiple definitions')
    }
    subsetTools[0].tools = definitions.slice(0, 1)
    const subsetDirectory = join(directory, 'subset')
    await mkdir(subsetDirectory, { recursive: true })
    const subset = await createTaskModelStreamFetchFixture(
      subsetDirectory,
      controlledTaskModelResponseStream({ tools: subsetTools })
    )
    fixtures.push(subset)
    subset.params.bodyBase64 = controlledTaskModelRequest(subset.params.bodyBase64)
    await subset.channel.start(subset.params)
    await expect(finishModelRequest(subset.channel, subset.params.requestId)).rejects.toThrow(
      'TASK_MODEL_STREAM_REFUSED'
    )
  })

  it('keeps the admitted original reader context when an overlapping valid start is refused', async () => {
    const readers: ((data: string) => void)[] = []
    const original = policies.createTaskModelPolicy
    vi.spyOn(policies, 'createTaskModelPolicy').mockImplementation((profile) => {
      const policy = original(profile)
      const capture = policy.responseEvent
      policy.responseEvent = (body) => {
        const reader = capture(body)
        readers.push(reader)
        return reader
      }
      return policy
    })
    const f = await fixture()
    const session = f.owner.store.getRecord(f.owner.binding.sessionId)
    await f.channel.start(f.params)
    const body: Record<string, unknown> = JSON.parse(
      Buffer.from(f.params.bodyBase64, 'base64').toString()
    )
    body.text = { verbosity: 'high' }
    await expect(f.channel.start(modelStartParams(body))).rejects.toThrow(
      'TASK_MODEL_BUDGET_REFUSED'
    )
    expect(readers).toHaveLength(1)
    expect(() =>
      readers[0](
        JSON.stringify({
          type: 'response.created',
          response: { id: 'resp-fixture', text: { verbosity: 'low' } }
        })
      )
    ).not.toThrow()
    expect(() =>
      readers[0](
        JSON.stringify({
          type: 'response.created',
          response: { id: 'resp-fixture', text: { verbosity: 'high' } }
        })
      )
    ).toThrow('RESPONSE_CONFIGURATION')
    expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
    const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
    expect(task.modelDispatchAttempts).toBe(1)
    expect(task.result).toBeNull()
  })

  it('uses each sequential original Task/global-Fetch request snapshot with one debit each', async () => {
    const f = await fixture()
    let body = f.body
    f.server.removeAllListeners('request')
    f.server.on('request', (_request, reply) => {
      reply.writeHead(200)
      reply.end(body)
    })
    const session = f.owner.store.getRecord(f.owner.binding.sessionId)
    await f.channel.start(f.params)
    expect(await finishModelRequest(f.channel, f.params.requestId)).toBe(body)
    const request: Record<string, unknown> = JSON.parse(
      Buffer.from(f.params.bodyBase64, 'base64').toString()
    )
    request.text = { verbosity: 'high' }
    request.reasoning = { effort: 'low', context: 'all_turns', summary: 'detailed' }
    body = controlledTaskModelResponseStream({
      text: { format: { type: 'text' }, verbosity: 'high' },
      reasoning: request.reasoning
    })
    const next = modelStartParams(request)
    await f.channel.start(next)
    expect(await finishModelRequest(f.channel, next.requestId)).toBe(body)
    await f.channel.close()
    const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
    expect(task.modelDispatchAttempts).toBe(2)
    expect(task.result).toBeNull()
    expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
  })
  it.each([null, { cyber: 'standard' }, { cyber: 'daybreak_blue' }, { cyber: 'daybreak_red' }])(
    'preserves the controlled full envelope and descriptive access program case %#',
    async (access_programs) => {
      const f = await fixture({ access_programs })
      const before = f.owner.store.tasks.get(f.owner.command)!
      const session = f.owner.store.getRecord(f.owner.binding.sessionId)
      await f.channel.start(f.params)
      expect(await finishModelRequest(f.channel, f.params.requestId)).toBe(f.body)
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
    }
  )

  it.each([
    { label: 'foreign model', value: { model: 'foreign' } },
    { label: 'unknown envelope field', value: { 'private-key': 'body-token-secret' } },
    {
      label: 'program capability addition',
      value: { access_programs: { cyber: 'standard', grant: true } }
    },
    { label: 'invalid program enum', value: { access_programs: { cyber: 'unapproved' } } },
    { label: 'foreign context', value: { previous_response_id: 'body-token-secret' } },
    { label: 'foreign conversation', value: { conversation: { id: 'body-token-secret' } } },
    { label: 'template context', value: { prompt: { id: 'body-token-secret' } } },
    { label: 'foreign tools', value: { tools: [{ type: 'web_search' }] } },
    { label: 'control mismatch', value: { parallel_tool_calls: true } },
    { label: 'store mismatch', value: { store: true } },
    { label: 'foreign effort', value: { reasoning: { effort: 'high' } } },
    { label: 'format control', value: { text: { format: { type: 'json_object' } } } },
    { label: 'foreign service tier', value: { service_tier: 'flex' } },
    { label: 'malformed numeric metadata', value: { max_output_tokens: 'body-token-secret' } },
    { label: 'oversized numeric metadata', value: { max_output_tokens: Number.MAX_SAFE_INTEGER } }
  ])(
    'refuses $label and persists no sensitive values or fabricated outcomes',
    async ({ value }) => {
      const f = await fixture(value)
      await f.channel.start(f.params)
      await expect(finishModelRequest(f.channel, f.params.requestId)).rejects.toThrow(
        'TASK_MODEL_STREAM_REFUSED'
      )
      await f.channel.close()
      const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
      expect(task.result).toBeNull()
      expect(task.modelDispatchAttempts).toBe(1)
      expect(JSON.stringify(task.events)).not.toMatch(/body-token-secret|private-key|unapproved/)
    }
  )
})
