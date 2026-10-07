import { describe, expect, it } from 'vitest'
import { createTaskModelPolicy } from './task-model-policy'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { taskModelStreamDiagnostic } from './task-model-stream-failure'

const buffering = { use_cases: ['synthetic'], reasons: ['synthetic'], retry_model: null }
const profile = {
  ...taskDockerModelProfile(),
  responsesLite: false,
  approvedTools: [
    {
      type: 'function',
      name: 'local_tool',
      description: 'Synthetic local tool',
      strict: false,
      parameters: { type: 'object', properties: {} }
    },
    {
      type: 'custom',
      name: 'local_custom',
      description: 'Synthetic local custom tool',
      format: { type: 'grammar', syntax: 'lark', definition: 'start: TEXT\nTEXT: /.+/' }
    }
  ]
}
const response = { id: 'resp-fixture' }
const item = { type: 'message', role: 'assistant', content: [] }
const call = {
  type: 'function_call',
  id: 'item-fixture',
  call_id: 'call-fixture',
  name: 'local_tool',
  arguments: ''
}
const supported = [
  ...[
    'response.created',
    'response.in_progress',
    'response.completed',
    'response.incomplete',
    'response.failed'
  ].map((type) => ({ type, response })),
  ...['response.output_item.added', 'response.output_item.done'].map((type) => ({ type, item })),
  ...['response.content_part.added', 'response.content_part.done'].map((type) => ({
    type,
    part: { type: 'output_text', text: '' }
  })),
  ...['response.reasoning_summary_part.added', 'response.reasoning_summary_part.done'].map(
    (type) => ({ type, part: { type: 'summary_text', text: '' } })
  ),
  ...[
    'response.output_text.delta',
    'response.reasoning_summary_text.delta',
    'response.reasoning_text.delta'
  ].map((type) => ({ type, delta: '' })),
  ...['response.output_text.done', 'response.reasoning_summary_text.done'].map((type) => ({
    type,
    text: ''
  })),
  { type: 'response.metadata', metadata: {} },
  { type: 'error', error: { message: 'Synthetic failure' } }
]

describe('bounded pinned safety buffering event contract', () => {
  it.each(supported)('validates the signal on supported $type envelopes', (event) => {
    const policy = createTaskModelPolicy(profile)
    expect(() =>
      policy.event(JSON.stringify({ ...event, safety_buffering: buffering }))
    ).not.toThrow()
    expect(() => policy.event(JSON.stringify({ ...event, safety_buffering: true }))).toThrow(
      'OBJECT'
    )
  })

  it.each(['response.function_call_arguments.delta', 'response.function_call_arguments.done'])(
    'retains original call matching for %s with a validated signal',
    (type) => {
      const policy = createTaskModelPolicy(profile)
      policy.event(JSON.stringify({ type: 'response.output_item.added', item: call }))
      const field = type.endsWith('.delta') ? 'delta' : 'arguments'
      expect(() =>
        policy.event(
          JSON.stringify({ type, item_id: call.id, [field]: '', safety_buffering: buffering })
        )
      ).not.toThrow()
      expect(() =>
        policy.event(
          JSON.stringify({ type, item_id: 'foreign', [field]: '', safety_buffering: buffering })
        )
      ).toThrow('DELTA_CALL_UNPROVEN')
    }
  )

  it.each(['response.custom_tool_call_input.delta', 'response.custom_tool_call_input.done'])(
    'retains custom call matching and safety validation for %s',
    (type) => {
      const policy = createTaskModelPolicy(profile)
      const item = {
        type: 'custom_tool_call',
        id: 'custom-fixture',
        call_id: 'custom-call',
        name: 'local_custom',
        input: ''
      }
      policy.event(JSON.stringify({ type: 'response.output_item.added', item }))
      const field = type.endsWith('.delta') ? 'delta' : 'input'
      const event = { type, item_id: item.id, [field]: '', safety_buffering: buffering }
      expect(() => policy.event(JSON.stringify(event))).not.toThrow()
      expect(() => policy.event(JSON.stringify({ ...event, item_id: 'foreign' }))).toThrow(
        'DELTA_CALL_UNPROVEN'
      )
      expect(() => policy.event(JSON.stringify({ ...event, safety_buffering: true }))).toThrow(
        'OBJECT'
      )
    }
  )

  it.each([
    { label: 'true marker', value: true, reason: 'OBJECT' },
    { label: 'string marker', value: 'synthetic', reason: 'OBJECT' },
    { label: 'array marker', value: [], reason: 'OBJECT' },
    { label: 'number marker', value: 1, reason: 'OBJECT' },
    { label: 'missing arrays', value: {}, reason: 'REQUIRED_FIELD' },
    { label: 'missing reasons', value: { use_cases: [] }, reason: 'REQUIRED_FIELD' },
    { label: 'null use cases', value: { ...buffering, use_cases: null }, reason: 'ARRAY' },
    { label: 'null reasons', value: { ...buffering, reasons: null }, reason: 'ARRAY' },
    {
      label: 'nonnull retry model',
      value: { ...buffering, retry_model: 'unapproved' },
      reason: 'SAFETY_BUFFERING_UNSUPPORTED'
    },
    {
      label: 'selected retry model',
      value: { ...buffering, retry_model: profile.model },
      reason: 'SAFETY_BUFFERING_UNSUPPORTED'
    },
    {
      label: 'false retry model',
      value: { ...buffering, retry_model: false },
      reason: 'SAFETY_BUFFERING_UNSUPPORTED'
    },
    {
      label: 'array retry model',
      value: { ...buffering, retry_model: [] },
      reason: 'SAFETY_BUFFERING_UNSUPPORTED'
    },
    {
      label: 'input faster model',
      value: { ...buffering, faster_model: null },
      reason: 'UNKNOWN_FIELD'
    },
    {
      label: 'client display state',
      value: { ...buffering, show_buffering_ui: false },
      reason: 'UNKNOWN_FIELD'
    },
    {
      label: 'unknown field',
      value: { ...buffering, 'private-key': 'synthetic' },
      reason: 'UNKNOWN_FIELD'
    },
    {
      label: 'too many reasons',
      value: { ...buffering, reasons: Array(33).fill('synthetic') },
      reason: 'ARRAY'
    },
    {
      label: 'too many use cases',
      value: { ...buffering, use_cases: Array(33).fill('synthetic') },
      reason: 'ARRAY'
    },
    {
      label: 'long ASCII string',
      value: { ...buffering, reasons: ['a'.repeat(129)] },
      reason: 'STRING'
    },
    {
      label: 'long UTF8 string',
      value: { ...buffering, reasons: ['码'.repeat(43)] },
      reason: 'STRING'
    },
    {
      label: 'control character',
      value: { ...buffering, reasons: ['line\nsynthetic'] },
      reason: 'STRING'
    },
    { label: 'nonstring entry', value: { ...buffering, reasons: [false] }, reason: 'STRING' }
  ])('refuses $label through the actual policy producer', ({ value, reason }) => {
    let error: unknown
    try {
      createTaskModelPolicy(profile).event(
        JSON.stringify({ type: 'response.output_text.delta', delta: '', safety_buffering: value })
      )
    } catch (actual) {
      error = actual
    }
    expect(taskModelStreamDiagnostic(error)).toMatchObject({
      streamReason: 'policy',
      policyReason: reason,
      policyLocation: 'safety_buffering'
    })
    expect(String(error)).not.toContain('private-key')
  })

  it('accepts empty arrays and the explicit UTF8/count bounds without changing the payload', () => {
    const policy = createTaskModelPolicy(profile)
    for (const value of [
      { use_cases: [], reasons: [] },
      {
        use_cases: Array(32).fill('a'.repeat(128)),
        reasons: [`${'码'.repeat(42)}ab`],
        retry_model: null
      }
    ]) {
      const event = JSON.stringify({
        type: 'response.output_text.delta',
        delta: '',
        safety_buffering: value
      })
      expect(() => policy.event(event)).not.toThrow()
      expect(JSON.parse(event).safety_buffering).toEqual(value)
    }
  })

  it('keeps malformed and unsupported metadata fallback closed', () => {
    const policy = createTaskModelPolicy(profile)
    for (const metadata of [
      { type: 'safety_buffering', use_cases: [] },
      { type: 'safety_buffering', ...buffering, retry_model: 'foreign' },
      { type: 'other', ...buffering },
      { ...buffering },
      { type: 'safety_buffering', ...buffering, extra: true }
    ]) {
      expect(() =>
        policy.event(
          JSON.stringify({ type: 'response.metadata', safety_buffering: false, metadata })
        )
      ).toThrow('TASK_MODEL_POLICY_REFUSED:')
    }
    expect(() =>
      policy.event(JSON.stringify({ type: 'response.unknown', safety_buffering: buffering }))
    ).toThrow('EVENT_UNSUPPORTED')
    expect(() =>
      policy.event(
        JSON.stringify({
          type: 'response.created',
          response: { ...response, metadata: { type: 'safety_buffering', ...buffering } }
        })
      )
    ).toThrow('UNKNOWN_FIELD')
    expect(() =>
      policy.event(JSON.stringify({ type: 'response.created', safety_buffering: buffering }))
    ).toThrow('REQUIRED_FIELD')
  })
})
