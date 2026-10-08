import { describe, expect, it } from 'vitest'
import { createTaskModelPolicy } from './task-model-policy'
import { modelRequestBody } from './task-model-broker.test-fixture'
import { controlledTaskModelResponse } from './task-model-response-envelope.test-fixture'

function check(fields: Record<string, unknown>) {
  const policy = createTaskModelPolicy({
    model: modelRequestBody.model,
    responsesLite: false,
    approvedTools: [],
    reasoningEfforts: ['low']
  })
  policy.responseEvent(JSON.stringify(modelRequestBody))(
    JSON.stringify({
      type: 'response.created',
      response: controlledTaskModelResponse({
        instructions: 'Code only',
        parallel_tool_calls: true,
        reasoning: { effort: 'low', summary: 'auto' },
        ...fields
      })
    })
  )
}

describe('documented provider cache retention', () => {
  it.each(['24h', 'in_memory', null])('admits the response retention %s', (retention) => {
    expect(() => check({ prompt_cache_retention: retention })).not.toThrow()
  })

  it.each(['48h', '', 24, {}, [], true])(
    'denies unsupported response retention %#',
    (retention) => {
      expect(() => check({ prompt_cache_retention: retention })).toThrow(
        'TASK_MODEL_POLICY_REFUSED:'
      )
    }
  )

  it('does not admit new request cache controls', () => {
    const policy = createTaskModelPolicy({
      model: modelRequestBody.model,
      responsesLite: false,
      approvedTools: [],
      reasoningEfforts: ['low']
    })
    expect(() =>
      policy.request(JSON.stringify({ ...modelRequestBody, prompt_cache_retention: '24h' }))
    ).toThrow('TASK_MODEL_POLICY_REFUSED:UNKNOWN_FIELD')
  })

  it('admits bounded provider identifiers as response metadata', () => {
    expect(() =>
      check({ prompt_cache_key: 'fixture-cache', safety_identifier: 'fixture-safety' })
    ).not.toThrow()
  })

  it.each(['prompt_cache_key', 'safety_identifier'])(
    'rejects malformed, control-bearing and oversized %s',
    (field) => {
      const maximum = field === 'safety_identifier' ? 128 : 160
      for (const value of [
        {},
        [],
        true,
        1,
        '',
        'bad\u0000identifier',
        'bad\u007fidentifier',
        'bad\u0085identifier',
        'x'.repeat(maximum + 1)
      ]) {
        expect(() => check({ [field]: value })).toThrow('TASK_MODEL_POLICY_REFUSED:')
      }
    }
  )

  it('accepts the observed standard reasoning mode while denying pro', () => {
    expect(() =>
      check({ reasoning: { effort: 'low', summary: 'auto', mode: 'standard' } })
    ).not.toThrow()
    expect(() => check({ reasoning: { effort: 'low', summary: 'auto', mode: 'pro' } })).toThrow(
      'TASK_MODEL_POLICY_REFUSED:'
    )
  })
})
