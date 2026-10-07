import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskModelPolicy } from './task-model-policy'
import {
  modelRequestBody,
  modelEvent,
  modelBrokerFixture,
  modelStartParams,
  modelResponse,
  finishModelRequest
} from './task-model-broker.test-fixture'
import { controlledTaskModelResponse } from './task-model-response-envelope.test-fixture'
import { captureTaskModelResponseConfiguration } from './task-model-response-configuration'
import * as policies from './task-model-policy'
import { taskDockerModelProfile } from './task-docker-model-profile'

const profile = {
  model: modelRequestBody.model,
  responsesLite: false,
  approvedTools: [],
  reasoningEfforts: ['low', 'medium']
}
const originalBody = JSON.stringify(modelRequestBody)
const matching = (overrides: Record<string, unknown> = {}) =>
  controlledTaskModelResponse({
    instructions: 'Code only',
    parallel_tool_calls: true,
    reasoning: { effort: 'low', summary: 'auto', context: null },
    ...overrides
  })
const fixtures: ReturnType<typeof modelBrokerFixture>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.channel.close()))
  vi.restoreAllMocks()
})

describe('immutable original reader response configuration', () => {
  it.each([undefined, null, 'additional-tools-fixture'])(
    'retains accepted optional additional_tools id case %# through the original reader',
    (id) => {
      const selected = taskDockerModelProfile()
      const prefix = {
        type: 'additional_tools',
        role: 'developer',
        tools: selected.approvedTools,
        ...(id === undefined ? {} : { id })
      }
      const body = JSON.stringify({
        ...modelRequestBody,
        instructions: '',
        tools: undefined,
        parallel_tool_calls: false,
        input: [prefix],
        reasoning: { effort: 'low', context: 'all_turns' }
      })
      const policy = createTaskModelPolicy(selected)
      const canonical = policy.request(body)
      expect(JSON.parse(canonical).input[0]).toEqual(prefix)
      expect(() =>
        policy.responseEvent(canonical)(
          JSON.stringify({
            type: 'response.created',
            response: controlledTaskModelResponse()
          })
        )
      ).not.toThrow()
    }
  )

  it.each([{ id: '' }, { id: 7 }, { id: 'bad\u0000id' }, { id: 'a'.repeat(161) }, { extra: true }])(
    'keeps malformed id or unknown additional_tools prefix case %# under original request validation',
    (prefix) => {
      const selected = taskDockerModelProfile()
      const body = JSON.stringify({
        ...modelRequestBody,
        instructions: '',
        tools: undefined,
        parallel_tool_calls: false,
        input: [
          { type: 'additional_tools', role: 'developer', tools: selected.approvedTools, ...prefix }
        ],
        reasoning: { effort: 'low', context: 'all_turns' }
      })
      const policy = createTaskModelPolicy(selected)
      expect(() => policy.request(body)).toThrow('TASK_MODEL_POLICY_REFUSED:')
      expect(() => policy.responseEvent(body)).toThrow('TASK_MODEL_POLICY_REFUSED:')
    }
  )

  it('stores only frozen digests and bounded controls, without retaining instructions/input', () => {
    const body = createTaskModelPolicy(profile).request(originalBody)
    const configuration = captureTaskModelResponseConfiguration(body, profile.model, false)
    expect(Object.isFrozen(configuration)).toBe(true)
    expect(Object.isFrozen(configuration.echoes)).toBe(true)
    expect(JSON.stringify(configuration)).not.toMatch(
      /Code only|Write code|input|instructions.*Code/
    )
    expect(configuration.echoes.instructions).toMatch(/^[a-f0-9]{64}$/)
  })

  it('binds independent sequential configurations while retaining shared opaque replay proof', () => {
    const policy = createTaskModelPolicy(profile)
    const first = policy.responseEvent(originalBody)
    const secondBody = {
      ...modelRequestBody,
      instructions: 'Second original',
      reasoning: { effort: 'medium', summary: 'detailed' },
      text: { verbosity: 'high' }
    }
    const second = policy.responseEvent(JSON.stringify(secondBody))
    expect(() =>
      first(modelEvent('response.created', { response: matching() }).split('data: ')[1].trim())
    ).not.toThrow()
    expect(() =>
      second(
        JSON.stringify({
          type: 'response.created',
          response: matching({
            instructions: 'Second original',
            reasoning: secondBody.reasoning,
            text: { verbosity: 'high' }
          })
        })
      )
    ).not.toThrow()
    expect(() =>
      first(
        JSON.stringify({
          type: 'response.created',
          response: matching({ instructions: 'Second original' })
        })
      )
    ).toThrow('RESPONSE_CONFIGURATION')
    expect(() =>
      second(JSON.stringify({ type: 'response.created', response: matching() }))
    ).toThrow('RESPONSE_CONFIGURATION')
    first(
      JSON.stringify({
        type: 'response.output_item.done',
        item: { type: 'reasoning', summary: [], encrypted_content: 'synthetic-opaque' }
      })
    )
    expect(() =>
      policy.responseEvent(
        JSON.stringify({
          ...modelRequestBody,
          input: [{ type: 'reasoning', summary: [], encrypted_content: 'synthetic-opaque' }]
        })
      )
    ).not.toThrow()
    expect(() =>
      createTaskModelPolicy(profile).responseEvent(
        JSON.stringify({
          ...modelRequestBody,
          input: [{ type: 'reasoning', summary: [], encrypted_content: 'synthetic-opaque' }]
        })
      )
    ).toThrow('OPAQUE_REPLAY_UNPROVEN')
  })

  it.each([
    { label: 'unexpected instruction array', value: { instructions: [] } },
    { label: 'foreign choice', value: { tool_choice: 'required' } },
    { label: 'wrong boolean null', value: { parallel_tool_calls: null } },
    { label: 'changed summary', value: { reasoning: { summary: 'detailed' } } },
    { label: 'changed context', value: { reasoning: { context: 'all_turns' } } },
    { label: 'unsupported mode', value: { reasoning: { mode: 'pro' } } },
    { label: 'nested unknown', value: { reasoning: { 'private-key': 'secret-value' } } },
    { label: 'changed verbosity', value: { text: { verbosity: 'high' } } },
    { label: 'tier opt-in', value: { service_tier: 'priority' } },
    { label: 'unexpected retention', value: { prompt_cache_retention: '24h' } },
    { label: 'unexpected cache state', value: { prompt_cache_options: {} } },
    { label: 'unexpected identity', value: { safety_identifier: 'secret-value' } },
    { label: 'moderation object', value: { moderation: {} } },
    { label: 'automatic truncation', value: { truncation: 'auto' } },
    { label: 'bad temperature', value: { temperature: 2.01 } },
    { label: 'bad top p', value: { top_p: -1 } },
    { label: 'bad logprobs', value: { top_logprobs: 21 } },
    { label: 'bad call limit', value: { max_tool_calls: 2 ** 31 } },
    { label: 'premature timestamp', value: { completed_at: 1 } },
    { label: 'blank metadata property', value: { metadata: { '': 1 } } }
  ])('keeps $label closed', ({ value }) => {
    const event = createTaskModelPolicy(profile).responseEvent(originalBody)
    expect(() =>
      event(JSON.stringify({ type: 'response.created', response: matching(value) }))
    ).toThrow('TASK_MODEL_POLICY_REFUSED:')
  })

  it('accepts bounded readonly scalars and null synchronous metadata without changing effect policy', () => {
    const event = createTaskModelPolicy(profile).responseEvent(originalBody)
    expect(() =>
      event(
        JSON.stringify({
          type: 'response.completed',
          response: matching({
            status: 'completed',
            completed_at: 0.5,
            background: null,
            metadata: null,
            temperature: 0,
            top_p: 0.2,
            top_logprobs: 20,
            max_tool_calls: 2 ** 31 - 1,
            max_output_tokens: 0
          })
        })
      )
    ).not.toThrow()
    expect(() =>
      event(
        JSON.stringify({
          type: 'response.completed',
          response: matching({ status: 'completed', usage_metadata: {} })
        })
      )
    ).toThrow('USAGE_METADATA_UNSUPPORTED')
    expect(() =>
      event(
        JSON.stringify({
          type: 'response.created',
          response: matching({ metadata: { grant: true } })
        })
      )
    ).toThrow('UNKNOWN_FIELD')
  })

  it.each([
    '{"type":"response.created","response":{"id":"resp-fixture","access_programs":{"cyber":"standard","cyber":"daybreak_red"}}}',
    '{"type":"response.created","response":{"id":"resp-fixture","access_programs":{"cyber":"standard","__proto__":{}}}}'
  ])('preserves strict duplicate/prototype JSON rejection case %#', (data) => {
    expect(() => createTaskModelPolicy(profile).responseEvent(originalBody)(data)).toThrow(
      'TASK_MODEL_POLICY_REFUSED:'
    )
  })

  it('captures after original reservation and never retags an original reader after rejected overlap', async () => {
    const readers: ((data: string) => void)[] = []
    const original = createTaskModelPolicy
    vi.spyOn(policies, 'createTaskModelPolicy').mockImplementation((selected) => {
      const policy = original(selected)
      const capture = policy.responseEvent
      policy.responseEvent = (body) => {
        const reader = capture(body)
        readers.push(reader)
        return reader
      }
      return policy
    })
    let reserved!: () => void
    const reservation = new Promise<void>((done) => {
      reserved = done
    })
    const reserveDispatch = vi.fn(async () => reservation)
    const f = modelBrokerFixture({ reserveDispatch })
    fixtures.push(f)
    const started = f.channel.start(modelStartParams())
    await vi.waitFor(() => expect(reserveDispatch).toHaveBeenCalledOnce())
    expect(readers).toHaveLength(0)
    reserved()
    await started
    expect(readers).toHaveLength(1)
    await expect(
      f.channel.start(
        modelStartParams({
          ...modelRequestBody,
          instructions: 'Other original',
          text: { verbosity: 'high' }
        })
      )
    ).rejects.toThrow('TASK_MODEL_BUDGET_REFUSED')
    expect(readers).toHaveLength(1)
    expect(() =>
      readers[0](JSON.stringify({ type: 'response.created', response: matching() }))
    ).not.toThrow()
    expect(() =>
      readers[0](
        JSON.stringify({
          type: 'response.created',
          response: matching({ instructions: 'Other original' })
        })
      )
    ).toThrow('RESPONSE_CONFIGURATION')
    expect(reserveDispatch).toHaveBeenCalledOnce()
  })

  it('uses each sequential admitted broker request control snapshot', async () => {
    const f = modelBrokerFixture({
      profile,
      request: async (_input, init) => {
        const request: Record<string, unknown> = JSON.parse(String(init?.body))
        const response = matching({
          instructions: request.instructions,
          reasoning: request.reasoning,
          text: request.text ?? { verbosity: 'low' }
        })
        return modelResponse([
          modelEvent('response.created', { response }),
          modelEvent('response.completed', { response: { ...response, status: 'completed' } })
        ]).reply
      }
    })
    fixtures.push(f)
    for (const body of [
      modelRequestBody,
      {
        ...modelRequestBody,
        instructions: 'Second original',
        reasoning: { effort: 'medium', summary: 'detailed' },
        text: { verbosity: 'high' }
      }
    ]) {
      const params = modelStartParams(body)
      await f.channel.start(params)
      expect(await finishModelRequest(f.channel, params.requestId)).toContain('response.completed')
    }
    expect(f.reserveDispatch).toHaveBeenCalledTimes(2)
  })
})
