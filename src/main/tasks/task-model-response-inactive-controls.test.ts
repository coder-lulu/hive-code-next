import { describe, expect, it } from 'vitest'
import { createTaskModelPolicy } from './task-model-policy'
import { modelRequestBody } from './task-model-broker.test-fixture'
import { controlledTaskModelResponse } from './task-model-response-envelope.test-fixture'

function reader() {
  return createTaskModelPolicy({
    model: modelRequestBody.model,
    responsesLite: false,
    approvedTools: [],
    reasoningEfforts: ['low']
  }).responseEvent(JSON.stringify(modelRequestBody))
}

function event(type: string, fields: Record<string, unknown>) {
  return JSON.stringify({
    type,
    response: controlledTaskModelResponse({
      instructions: 'Code only',
      parallel_tool_calls: true,
      reasoning: { effort: 'low', summary: 'auto' },
      ...(type === 'response.completed' ? { status: 'completed', completed_at: 1 } : {}),
      ...fields
    })
  })
}

const inactiveToolUsage = () => ({
  image_gen: {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    input_tokens_details: { image_tokens: 0, text_tokens: 0 },
    output_tokens_details: { image_tokens: 0, text_tokens: 0 }
  },
  web_search: { num_requests: 0 }
})

describe('inactive controls on authenticated Codex response envelopes', () => {
  it.each(['response.created', 'response.in_progress', 'response.completed'])(
    'admits the observed zero penalties on %s without changing the request',
    (type) => {
      expect(() =>
        reader()(event(type, { frequency_penalty: 0, presence_penalty: 0 }))
      ).not.toThrow()
    }
  )

  it.each(['frequency_penalty', 'presence_penalty'])(
    'rejects nondefault or malformed %s',
    (field) => {
      for (const value of [null, true, '0', [], {}, -1, 0.1, 1]) {
        expect(() => reader()(event('response.created', { [field]: value }))).toThrow(
          'TASK_MODEL_POLICY_REFUSED:'
        )
      }
    }
  )

  it('keeps unrecognized zero controls denied', () => {
    expect(() => reader()(event('response.created', { unapproved_penalty: 0 }))).toThrow(
      'TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD'
    )
  })

  it.each(['response.created', 'response.in_progress', 'response.completed'])(
    'admits only inactive hosted tool accounting on %s',
    (type) => {
      expect(() => reader()(event(type, { tool_usage: inactiveToolUsage() }))).not.toThrow()
    }
  )

  it.each([
    null,
    [],
    {},
    { image_gen: {} },
    { ...inactiveToolUsage(), unknown_tool: { num_requests: 0 } },
    { ...inactiveToolUsage(), web_search: { num_requests: 1 } },
    { ...inactiveToolUsage(), web_search: { num_requests: null } },
    { ...inactiveToolUsage(), web_search: { num_requests: 0, unknown: 0 } },
    { ...inactiveToolUsage(), image_gen: { ...inactiveToolUsage().image_gen, total_tokens: 1 } },
    {
      ...inactiveToolUsage(),
      image_gen: {
        ...inactiveToolUsage().image_gen,
        input_tokens_details: { image_tokens: 1, text_tokens: 0 }
      }
    },
    {
      ...inactiveToolUsage(),
      image_gen: {
        ...inactiveToolUsage().image_gen,
        output_tokens_details: { image_tokens: 0, text_tokens: '0' }
      }
    },
    {
      ...inactiveToolUsage(),
      image_gen: { ...inactiveToolUsage().image_gen, input_tokens_details: { image_tokens: 0 } }
    },
    {
      ...inactiveToolUsage(),
      image_gen: {
        ...inactiveToolUsage().image_gen,
        output_tokens_details: { image_tokens: 0, text_tokens: 0, other_tokens: 0 }
      }
    }
  ])('rejects active, unknown, incomplete or malformed hosted tool accounting %#', (tool_usage) => {
    expect(() => reader()(event('response.created', { tool_usage }))).toThrow(
      'TASK_MODEL_POLICY_REFUSED:'
    )
  })

  it('keeps duplicate and prototype keys denied inside otherwise inactive statistics', () => {
    const data = event('response.created', { tool_usage: inactiveToolUsage() })
    for (const replacement of [
      '"num_requests":0,"num_requests":0',
      '"num_requests":0,"__proto__":{}'
    ]) {
      expect(() => reader()(data.replace('"num_requests":0', replacement))).toThrow(
        'TASK_MODEL_POLICY_REFUSED:'
      )
    }
  })
})
