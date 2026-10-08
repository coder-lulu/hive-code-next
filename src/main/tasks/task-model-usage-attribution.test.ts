import { describe, expect, it } from 'vitest'
import { createTaskModelPolicy } from './task-model-policy'
import { modelRequestBody } from './task-model-broker.test-fixture'
import { usage } from './task-model-policy-json'

const counts = () => ({
  input_tokens: 10,
  output_tokens: 0,
  cached_tokens: 5,
  cache_write_tokens: 0
})
const attribution = () => ({ items: { 'item-fixture': { ...counts(), content: [counts()] } } })
function check(value: unknown) {
  const policy = createTaskModelPolicy({
    model: modelRequestBody.model,
    responsesLite: false,
    approvedTools: [],
    reasoningEfforts: ['low']
  })
  policy.event(
    JSON.stringify({
      type: 'response.completed',
      response: {
        id: 'fixture',
        status: 'completed',
        usage: {
          input_tokens: 10,
          output_tokens: 0,
          total_tokens: 10,
          attribution: value
        }
      }
    })
  )
}

describe('item token usage attribution', () => {
  it('accepts observed item and content counts without replacing aggregate usage', () => {
    expect(() => check(attribution())).not.toThrow()
    expect(() => check({ items: { 'item-fixture': counts() } })).not.toThrow()
  })

  it.each([
    null,
    [],
    {},
    { items: [] },
    { items: { '': counts() } },
    { items: { ['x'.repeat(161)]: counts() } },
    { items: { item: { ...counts(), unknown: 0 } } },
    { items: { item: { input_tokens: 10 } } },
    { items: { item: { ...counts(), content: null } } },
    { items: { item: { ...counts(), content: [{ ...counts(), role: 'user' }] } } }
  ])('denies malformed attribution %#', (value) => {
    expect(() => check(value)).toThrow('TASK_MODEL_POLICY_REFUSED:')
  })

  it.each(['input_tokens', 'output_tokens', 'cached_tokens', 'cache_write_tokens'])(
    'denies invalid %s counters at both levels',
    (field) => {
      for (const value of [-1, 1.5, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => check({ items: { item: { ...counts(), [field]: value } } })).toThrow(
          'TASK_MODEL_POLICY_REFUSED:'
        )
        expect(() =>
          check({ items: { item: { ...counts(), content: [{ ...counts(), [field]: value }] } } })
        ).toThrow('TASK_MODEL_POLICY_REFUSED:')
      }
    }
  )

  it('denies overlarge attribution maps and content arrays', () => {
    expect(() =>
      check({
        items: Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`item-${i}`, counts()]))
      })
    ).toThrow('TASK_MODEL_POLICY_REFUSED:')
    expect(() =>
      check({ items: { item: { ...counts(), content: Array.from({ length: 513 }, counts) } } })
    ).toThrow('TASK_MODEL_POLICY_REFUSED:')
  })

  it('accepts positive output and cache-write counts at both levels', () => {
    const value = { ...counts(), output_tokens: 3, cache_write_tokens: 2 }
    expect(() => check({ items: { item: { ...value, content: [value] } } })).not.toThrow()
  })

  it('retains aggregate counter validation despite valid attribution', () => {
    expect(() =>
      usage({ input_tokens: -1, output_tokens: 0, total_tokens: 0, attribution: attribution() })
    ).toThrow('TASK_MODEL_POLICY_REFUSED:INTEGER')
    expect(() => check({ items: { ['bad\u0000id']: counts() } })).toThrow(
      'TASK_MODEL_POLICY_REFUSED:IDENTIFIER'
    )
  })

  it('supports the declared attribution limits beneath the independent parser limit', () => {
    const items = Object.fromEntries(
      Array.from({ length: 1024 }, (_, i) => [`item-${i}`, counts()])
    )
    expect(() =>
      usage({ input_tokens: 10, output_tokens: 0, total_tokens: 10, attribution: { items } })
    ).not.toThrow()
    expect(() =>
      check({ items: { item: { ...counts(), content: Array.from({ length: 512 }, counts) } } })
    ).not.toThrow()
  })
})
