import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { vi, type Mock } from 'vitest'
import { createTaskModelBroker } from './task-model-broker'
import type { TaskModelProfile } from './task-model-policy'

export const modelEvent = (type: string, rest: Record<string, unknown> = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`
export const createdModelEvent = modelEvent('response.created', {
  response: { id: 'resp-fixture' }
})
export const completedModelEvent = modelEvent('response.completed', {
  response: { id: 'resp-fixture' }
})
export const modelRequestBody = {
  model: 'gpt-6.1-sol',
  instructions: 'Code only',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Write code' }] }],
  tools: [],
  tool_choice: 'auto',
  parallel_tool_calls: true,
  reasoning: { effort: 'low', summary: 'auto' },
  store: false,
  stream: true,
  include: ['reasoning.encrypted_content']
}
export const modelStartParams = (body: unknown = modelRequestBody, requestId = randomUUID()) => ({
  requestId,
  bodyBase64: Buffer.from(JSON.stringify(body)).toString('base64')
})
export function modelResponse(
  chunks = [createdModelEvent, completedModelEvent],
  cancel = vi.fn<() => void>()
) {
  let cursor = 0
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (cursor < chunks.length) {
      controller.enqueue(Buffer.from(chunks[cursor++]))
    } else {
      controller.close()
    }
  })
  const reply = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
    headers: { 'content-type': 'text/event-stream' }
  })
  return { reply, pull, cancel }
}
type Options = Parameters<typeof createTaskModelBroker>[0]
type Fixture = {
  channel: ReturnType<typeof createTaskModelBroker>
  options: Options
  scope: { codexHome: string; providerAccountId: string; sessionId: string }
  readAuth: Mock<NonNullable<Options['readAuth']>>
  request: Mock<typeof fetch>
  reserveDispatch: Mock<Options['reserveDispatch']>
  assertCurrent: Mock<Options['assertCurrent']>
}
export function modelBrokerFixture(overrides: Partial<Options> = {}): Fixture {
  const scope = {
    codexHome: resolve('logs/paperclip-development/p3/model-channel/fake-home'),
    providerAccountId: 'fixture-account',
    sessionId: 'codex_fixture_session'
  }
  const readAuth = vi.fn<NonNullable<Options['readAuth']>>(async () => ({
    Authorization: 'Bearer offline_fixture',
    'ChatGPT-Account-Id': scope.providerAccountId
  }))
  const request = vi.fn<typeof fetch>(async () => modelResponse().reply)
  const reserveDispatch = vi.fn<Options['reserveDispatch']>(async () => undefined)
  const assertCurrent = vi.fn<Options['assertCurrent']>()
  const profile: TaskModelProfile = {
    model: 'gpt-6.1-sol',
    responsesLite: false,
    approvedTools: [],
    reasoningEfforts: ['low']
  }
  const options = {
    profile,
    authScope: scope,
    deadline: Date.now() + 300_000,
    assertCurrent,
    reserveDispatch,
    readAuth,
    request,
    ...overrides
  }
  const channel = createTaskModelBroker(options)
  return { channel, options, scope, readAuth, request, reserveDispatch, assertCurrent }
}
export async function finishModelRequest(
  channel: ReturnType<typeof createTaskModelBroker>,
  requestId: string
) {
  const chunks: Buffer[] = []
  for (let sequence = 0; sequence < 100; sequence++) {
    const value = await channel.next({ requestId, sequence })
    chunks.push(Buffer.from(value.bodyBase64, 'base64'))
    if (value.done) {
      return Buffer.concat(chunks).toString()
    }
  }
  throw new Error('Fixture request failed to complete')
}
