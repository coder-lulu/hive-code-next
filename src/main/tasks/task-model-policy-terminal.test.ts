import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskModelPolicy } from './task-model-policy'
import { taskDockerModelProfile } from './task-docker-model-profile'
import {
  createdModelEvent,
  finishModelRequest,
  modelBrokerFixture,
  modelEvent,
  modelResponse,
  modelStartParams
} from './task-model-broker.test-fixture'

const profile = taskDockerModelProfile()
const request = {
  model: profile.model,
  instructions: '',
  input: [
    { type: 'additional_tools', role: 'developer', tools: profile.approvedTools },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Write code' }] }
  ],
  tool_choice: 'auto',
  parallel_tool_calls: false,
  reasoning: { effort: 'low' },
  store: false,
  stream: true,
  include: ['reasoning.encrypted_content']
}
const contradictions = [
  { status: 'failed' },
  { status: 'in_progress' },
  { status: 'incomplete' },
  { status: 'completed', error: { code: 'fixture', message: 'Fixture failure' } },
  { status: 'completed', incomplete_details: { reason: 'max_output_tokens' } }
]
const fixtures: ReturnType<typeof modelBrokerFixture>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.channel.close()
  }
})

describe('validated model terminal state', () => {
  it.each(contradictions)('rejects contradictory completion at the policy boundary %#', (state) => {
    const policy = createTaskModelPolicy(profile)
    expect(() =>
      policy.event(
        JSON.stringify({ type: 'response.completed', response: { id: 'resp-fixture', ...state } })
      )
    ).toThrow('RESPONSE_TERMINAL_STATE')
  })

  it.each(contradictions)(
    'withholds contradictory terminal bytes and fences further dispatch %#',
    async (state) => {
      const response = modelResponse([
        createdModelEvent,
        modelEvent('response.completed', { response: { id: 'resp-fixture', ...state } })
      ])
      const fixture = modelBrokerFixture({ profile })
      fixture.request.mockResolvedValue(response.reply)
      fixtures.push(fixture)
      const failure = vi.fn()
      fixture.channel.onFailure(failure)
      const params = modelStartParams(request)
      await fixture.channel.start(params)
      const first = await fixture.channel.next({ requestId: params.requestId, sequence: 0 })
      expect(Buffer.from(first.bodyBase64, 'base64').toString()).toBe(createdModelEvent)
      expect(first.done).toBe(false)
      await expect(
        fixture.channel.next({ requestId: params.requestId, sequence: 1 })
      ).rejects.toThrow('TASK_MODEL_STREAM_REFUSED')
      expect(failure).toHaveBeenCalledTimes(1)
      expect(response.cancel).toHaveBeenCalledTimes(1)
      await expect(fixture.channel.start(modelStartParams(request))).rejects.toThrow(
        'TASK_MODEL_CHANNEL_UNAVAILABLE'
      )
      expect(fixture.reserveDispatch).toHaveBeenCalledTimes(1)
      expect(fixture.request).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    {},
    { status: 'completed' },
    { status: 'completed', end_turn: false },
    { status: 'completed', error: null, incomplete_details: null }
  ])('preserves supported completion and continuation semantics %#', async (state) => {
    const terminal = modelEvent('response.completed', {
      response: { id: 'resp-fixture', ...state }
    })
    const fixture = modelBrokerFixture({ profile })
    fixture.request.mockResolvedValue(modelResponse([createdModelEvent, terminal]).reply)
    fixtures.push(fixture)
    const params = modelStartParams(request)
    await fixture.channel.start(params)
    expect(await finishModelRequest(fixture.channel, params.requestId)).toBe(
      createdModelEvent + terminal
    )
  })
})
