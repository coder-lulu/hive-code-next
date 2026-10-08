import { describe, expect, it } from 'vitest'
import { createTaskModelPolicy } from './task-model-policy'
import { modelRequestBody } from './task-model-broker.test-fixture'

function event(type: string, fields: Record<string, unknown>) {
  const reader = createTaskModelPolicy({
    model: modelRequestBody.model,
    responsesLite: false,
    approvedTools: [],
    reasoningEfforts: ['low']
  }).responseEvent(JSON.stringify(modelRequestBody))
  reader(JSON.stringify({ type: 'response.created', response: { id: 'fixture' } }))
  reader(
    JSON.stringify({
      type,
      ...(type.endsWith('.delta') ? { delta: 'Synthetic text' } : { text: 'Synthetic text' }),
      ...fields
    })
  )
}

describe('inactive text stream metadata', () => {
  it('accepts observed empty logprobs and bounded delta padding', () => {
    expect(() =>
      event('response.output_text.delta', { logprobs: [], obfuscation: 'fixture-padding' })
    ).not.toThrow()
  })

  it('accepts empty output text logprobs on done without delta padding', () => {
    expect(() => event('response.output_text.done', { logprobs: [] })).not.toThrow()
  })

  it('accepts the padding size boundary', () => {
    expect(() =>
      event('response.output_text.delta', { obfuscation: 'x'.repeat(512) })
    ).not.toThrow()
  })

  it.each(['logprobs', 'obfuscation'])(
    'rejects %s on otherwise valid non-text event branches',
    (field) => {
      for (const message of [
        { type: 'response.created', response: { id: 'fixture' } },
        {
          type: 'response.output_item.added',
          item: { type: 'message', role: 'assistant', content: [] }
        },
        { type: 'response.content_part.added', part: { type: 'output_text', text: '' } }
      ]) {
        const policy = createTaskModelPolicy({
          model: modelRequestBody.model,
          responsesLite: false,
          approvedTools: [],
          reasoningEfforts: ['low']
        })
        expect(() =>
          policy.event(
            JSON.stringify({ ...message, [field]: field === 'logprobs' ? [] : 'fixture' })
          )
        ).toThrow('TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD')
      }
    }
  )

  it.each(['function', 'custom'])(
    'preserves approval and item association on padded %s deltas',
    (kind) => {
      const tool =
        kind === 'function'
          ? {
              type: kind,
              name: 'run',
              description: 'fixture',
              strict: false,
              parameters: { type: 'object' }
            }
          : {
              type: kind,
              name: 'run',
              description: 'fixture',
              format: { type: 'grammar', syntax: 'lark', definition: 'start: "fixture"' }
            }
      const policy = createTaskModelPolicy({
        model: modelRequestBody.model,
        responsesLite: false,
        approvedTools: [tool],
        reasoningEfforts: ['low']
      })
      const reader = policy.responseEvent(JSON.stringify({ ...modelRequestBody, tools: [tool] }))
      reader(JSON.stringify({ type: 'response.created', response: { id: 'fixture' } }))
      reader(
        JSON.stringify({
          type: 'response.output_item.added',
          item: {
            type: kind === 'function' ? 'function_call' : 'custom_tool_call',
            id: 'item',
            call_id: 'call',
            name: 'run',
            ...(kind === 'function' ? { arguments: '' } : { input: '' })
          }
        })
      )
      const delta = {
        type:
          kind === 'function'
            ? 'response.function_call_arguments.delta'
            : 'response.custom_tool_call_input.delta',
        item_id: 'item',
        call_id: 'call',
        delta: 'fixture',
        obfuscation: 'padding'
      }
      expect(() => reader(JSON.stringify(delta))).not.toThrow()
      expect(() => reader(JSON.stringify({ ...delta, call_id: 'foreign' }))).toThrow(
        'TASK_MODEL_POLICY_REFUSED:DELTA_CALL_UNPROVEN'
      )
      expect(() => reader(JSON.stringify({ ...delta, logprobs: [] }))).toThrow(
        'TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD'
      )
    }
  )

  it.each([null, {}, 0, 'empty', [{ token: 'x', logprob: 0 }]])(
    'rejects nonempty or malformed logprobs %#',
    (logprobs) => {
      expect(() => event('response.output_text.delta', { logprobs })).toThrow(
        'TASK_MODEL_POLICY_REFUSED:'
      )
    }
  )

  it.each([null, [], {}, 0, 'x'.repeat(513)])(
    'rejects malformed or oversized delta padding %#',
    (obfuscation) => {
      expect(() => event('response.output_text.delta', { obfuscation })).toThrow(
        'TASK_MODEL_POLICY_REFUSED:'
      )
    }
  )

  it('limits logprobs to output text and padding to deltas', () => {
    expect(() => event('response.reasoning_text.delta', { logprobs: [] })).toThrow(
      'TASK_MODEL_POLICY_REFUSED:'
    )
    expect(() => event('response.output_text.done', { obfuscation: 'fixture' })).toThrow(
      'TASK_MODEL_POLICY_REFUSED:'
    )
    expect(() => event('response.output_text.delta', { unknown_metadata: [] })).toThrow(
      'TASK_MODEL_POLICY_REFUSED:'
    )
  })
})
