import { describe, expect, it } from 'vitest'
import { createTaskModelPolicy, type TaskModelPolicyProfile } from './task-model-policy'
import {
  TASK_MODEL_EVENT_BYTES,
  TASK_MODEL_REQUEST_BYTES,
  TASK_MODEL_RESPONSE_BYTES
} from './task-model-channel-protocol'

const fn = {
  type: 'function',
  name: 'exec_command',
  description: 'Run local code',
  strict: false,
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
    additionalProperties: false
  }
}
const custom = {
  type: 'custom',
  name: 'apply_patch',
  description: 'Edit local code',
  format: { type: 'grammar', syntax: 'lark', definition: 'start: TEXT\nTEXT: /.+/' }
}
const namespace = {
  type: 'namespace',
  name: 'functions',
  description: 'Local tools',
  tools: [fn, custom]
}
const profile = (overrides: Partial<TaskModelPolicyProfile> = {}): TaskModelPolicyProfile => ({
  model: 'gpt-6.1-sol',
  responsesLite: false,
  approvedTools: [fn, custom],
  reasoningEfforts: ['low', 'medium'],
  ...overrides
})
const message = (
  content: unknown = [
    { type: 'input_text', text: 'Write code; https://example.test is ordinary text.' }
  ]
): unknown => ({ type: 'message', role: 'user', content })
const body = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  model: 'gpt-6.1-sol',
  instructions: 'Code only',
  input: [message()],
  tools: [fn, custom],
  tool_choice: 'auto',
  parallel_tool_calls: true,
  reasoning: { effort: 'low', summary: 'auto' },
  store: false,
  stream: true,
  include: ['reasoning.encrypted_content'],
  ...overrides
})
const liteBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
  const result = body({
    instructions: '',
    parallel_tool_calls: false,
    input: [{ type: 'additional_tools', role: 'developer', tools: [namespace] }, message()],
    ...overrides
  })
  delete result.tools
  return result
}
const functionCall = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'function_call',
  id: 'fc-1',
  call_id: 'call-1',
  name: 'exec_command',
  arguments: '{"command":"curl https://example.test"}',
  ...overrides
})
const customCall = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'custom_tool_call',
  id: 'ct-1',
  call_id: 'call-2',
  name: 'apply_patch',
  input: '*** Begin Patch\n*** End Patch',
  ...overrides
})
const reasoning = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'reasoning',
  id: 'rs-1',
  summary: [],
  encrypted_content: null,
  ...overrides
})
const outputMessage = (): unknown => ({
  type: 'message',
  id: 'msg-1',
  role: 'assistant',
  phase: 'final_answer',
  status: 'completed',
  content: [{ type: 'output_text', text: 'Done', annotations: [], logprobs: [] }]
})
const completed = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'response.completed',
  sequence_number: 8,
  response: {
    id: 'resp-1',
    object: 'response',
    created_at: 1780000000,
    status: 'completed',
    model: 'gpt-6.1-sol',
    output: [outputMessage()],
    end_turn: true,
    error: null,
    incomplete_details: null,
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 50, cache_write_tokens: 0 },
      output_tokens: 4,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 104,
      codex_rollout_budget_units: 1.25
    },
    ...overrides
  }
})
const send = (policy: ReturnType<typeof createTaskModelPolicy>, event: unknown): void =>
  policy.event(JSON.stringify(event))
const request = (policy: ReturnType<typeof createTaskModelPolicy>, value: unknown): string =>
  policy.request(JSON.stringify(value))
const refuse = (value: unknown, hostProfile = profile()): void => {
  expect(() => request(createTaskModelPolicy(hostProfile), value)).toThrow(
    'TASK_MODEL_POLICY_REFUSED:'
  )
}

describe('task model policy: pinned classic and lite requests', () => {
  it('canonicalizes approved local function/custom requests and does not scan plain text URLs', () => {
    const policy = createTaskModelPolicy(profile())
    const input = [
      message(),
      functionCall(),
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: [{ type: 'input_text', text: 'file:// is printed code' }]
      },
      customCall(),
      {
        type: 'custom_tool_call_output',
        call_id: 'call-2',
        name: 'apply_patch',
        output: 'https://example.test'
      }
    ]
    const actual = request(policy, body({ input }))
    expect(JSON.parse(actual)).toEqual(body({ input }))
    expect(actual.startsWith('{"include":')).toBe(true)
    expect(policy.request(actual)).toBe(actual)
  })

  it('accepts lite additional_tools with an exactly approved namespace wrapper', () => {
    const policy = createTaskModelPolicy(
      profile({ responsesLite: true, approvedTools: [namespace] })
    )
    expect(JSON.parse(request(policy, liteBody()))).toEqual(liteBody())
  })

  it('snapshots the Host inventory and effort/model policy', () => {
    const inventory = structuredClone([fn, custom])
    const host = profile({ approvedTools: inventory, reasoningEfforts: ['low'] })
    const policy = createTaskModelPolicy(host)
    inventory[0].description = 'Changed after creating the policy'
    host.model = 'unapproved-model'
    host.reasoningEfforts = ['high']
    expect(() => request(policy, body())).not.toThrow()
    expect(() => request(policy, body({ tools: inventory }))).toThrow('TOOL_DEFINITION_CHANGED')
    expect(() => request(policy, body({ reasoning: { effort: 'high' } }))).toThrow(
      'REASONING_EFFORT'
    )
  })

  it('validates then drops cache and the pinned client telemetry keys', () => {
    const result = JSON.parse(
      request(
        createTaskModelPolicy(profile()),
        body({
          prompt_cache_key: 'guest-session',
          client_metadata: {
            'x-codex-installation-id': 'guest',
            session_id: 'session',
            thread_id: 'thread',
            'x-codex-window-id': 'window',
            turn_id: 'turn',
            root_turn_id: 'root-turn',
            'x-codex-turn-metadata': '{"actor":"guest"}'
          }
        })
      )
    )
    expect(result.prompt_cache_key).toBeUndefined()
    expect(result.client_metadata).toBeUndefined()
  })

  it('supports the fixed Host service tier and rejects a changed tier', () => {
    expect(() =>
      request(
        createTaskModelPolicy(profile({ serviceTier: 'priority' })),
        body({ service_tier: 'priority' })
      )
    ).not.toThrow()
    refuse(body({ service_tier: 'flex' }), profile({ serviceTier: 'priority' }))
    refuse(body({ service_tier: 'priority' }))
  })

  it.each([
    ['model', 'different'],
    ['stream', false],
    ['store', true],
    ['tool_choice', 'required'],
    ['parallel_tool_calls', 'true'],
    ['include', []],
    ['include', ['reasoning.encrypted_content', 'web_search_call.action.sources']],
    ['max_output_tokens', 1],
    ['access_programs', {}],
    ['metadata', { actor: 'host' }],
    ['client_metadata', { actor: 'host' }],
    ['client_metadata', { account_id: 'other' }],
    ['client_metadata', { session_id: null }],
    ['client_metadata', { session_id: 7 }],
    ['prompt_cache_key', {}],
    ['stream_options', { reasoning_summary_delivery: 'sequential_cutoff' }],
    ['reasoning', { effort: 'high' }],
    ['reasoning', null],
    ['reasoning', {}],
    ['reasoning', { effort: 100 }],
    ['reasoning', { summary: null }],
    ['reasoning', { context: 'all_accounts' }],
    ['reasoning', { privileged: true }],
    ['instructions', null],
    ['input', {}],
    ['tools', {}],
    [
      'text',
      {
        format: {
          type: 'json_schema',
          name: 'code',
          strict: true,
          schema: { $ref: 'https://example.test/schema' }
        }
      }
    ]
  ])('rejects the changed/unknown %s field', (key, value) => refuse(body({ [key]: value })))

  it.each([
    ['missing prefix', { input: [message()] }],
    ['parallel calls', { parallel_tool_calls: true }],
    ['nonempty instructions', { instructions: 'external policy' }],
    [
      'duplicate prefix',
      {
        input: [
          { type: 'additional_tools', role: 'developer', tools: [namespace] },
          { type: 'additional_tools', role: 'developer', tools: [namespace] }
        ]
      }
    ],
    ['wrong role', { input: [{ type: 'additional_tools', role: 'system', tools: [namespace] }] }],
    [
      'unknown hosted tool',
      { input: [{ type: 'additional_tools', role: 'developer', tools: [{ type: 'web_search' }] }] }
    ]
  ])('rejects lite %s', (_, override) =>
    refuse(liteBody(override), profile({ responsesLite: true, approvedTools: [namespace] }))
  )

  it('rejects classic additional_tools and lite top-level tools', () => {
    refuse(body({ input: [{ type: 'additional_tools', role: 'developer', tools: [fn] }] }))
    const value = liteBody()
    value.tools = [namespace]
    refuse(value, profile({ responsesLite: true, approvedTools: [namespace] }))
  })
})

describe('task model policy: local tool and item authority', () => {
  it.each(['web_search', 'tool_search', 'file_search', 'computer', 'image_generation', 'mcp'])(
    'rejects hosted %s in both inventory and guest tools',
    (type) => {
      expect(() =>
        createTaskModelPolicy(
          profile({ approvedTools: [{ type, name: 'exec_command', description: 'Hosted' }] })
        )
      ).toThrow('TASK_MODEL_POLICY_REFUSED:')
      refuse(body({ tools: [{ type, name: 'exec_command', description: 'Hosted' }] }))
    }
  )

  it.each([
    { ...fn, description: 'Elevated tool' },
    { ...fn, parameters: { type: 'object', properties: { endpoint: { type: 'string' } } } },
    { ...custom, format: { ...custom.format, definition: 'anything' } },
    { ...fn, defer_loading: true },
    { ...fn, strict: 'false' },
    { ...fn, server_url: 'https://example.test' },
    { type: 'function', name: 'unknown', description: 'Unknown', strict: false, parameters: {} }
  ])('rejects mutated/unapproved local tools %#', (tool) => refuse(body({ tools: [tool] })))

  it('matches namespace descriptions, leaf definitions, placement, and names exactly', () => {
    const host = profile({ responsesLite: true, approvedTools: [namespace] })
    for (const tool of [
      { ...namespace, description: 'Changed' },
      { ...namespace, name: 'remote' },
      { ...namespace, tools: [{ ...fn, description: 'Changed' }, custom] },
      fn
    ]) {
      refuse(
        liteBody({
          input: [{ type: 'additional_tools', role: 'developer', tools: [tool] }, message()]
        }),
        host
      )
    }
    expect(() =>
      createTaskModelPolicy(profile({ approvedTools: [{ ...namespace, tools: [namespace] }] }))
    ).toThrow('TASK_MODEL_POLICY_REFUSED:')
  })

  it('rejects duplicate definitions and namespace collisions', () => {
    expect(() => createTaskModelPolicy(profile({ approvedTools: [fn, fn] }))).toThrow(
      'TOOL_COLLISION'
    )
    refuse(body({ tools: [fn, fn] }))
    refuse(body({ tools: [], input: [functionCall()] }), profile({ approvedTools: [] }))
    expect(() =>
      createTaskModelPolicy(profile({ approvedTools: [{ ...namespace, tools: [fn, fn] }] }))
    ).toThrow('TOOL_COLLISION')
  })

  it('rejects external schema references and prototype keys even in trusted inventory', () => {
    for (const parameters of [
      { $ref: 'https://example.test' },
      { properties: { nested: { $ref: 'file:///home/codex/auth.json' } } },
      { $id: 'ftp://example.test' },
      JSON.parse('{"constructor":{"type":"string"}}')
    ]) {
      expect(() =>
        createTaskModelPolicy(profile({ approvedTools: [{ ...fn, parameters }] }))
      ).toThrow('TASK_MODEL_POLICY_REFUSED:')
    }
  })

  it('accepts internal schema references after exact inventory approval', () => {
    const local = {
      ...fn,
      parameters: {
        type: 'object',
        $defs: { command: { type: 'string' } },
        properties: { command: { $ref: '#/$defs/command' } }
      }
    }
    const policy = createTaskModelPolicy(profile({ approvedTools: [local] }))
    expect(() => request(policy, body({ tools: [local] }))).not.toThrow()
  })

  it.each([
    { type: 'function_call', name: 'unknown', call_id: 'call-1', arguments: '{}' },
    functionCall({ namespace: 'remote' }),
    functionCall({ arguments: {} }),
    functionCall({ encrypted_function_args: ['opaque'] }),
    functionCall({ internal_chat_message_metadata_passthrough: { actor: 'host' } }),
    customCall({ input: {} }),
    { type: 'function_call_output', call_id: 'missing', output: 'OK' },
    { type: 'custom_tool_call_output', call_id: 'call-1', output: 'OK' },
    { type: 'function_call_output', call_id: 'call-1', name: 'apply_patch', output: 'OK' },
    { type: 'function_call_output', call_id: 'call-1', namespace: 'remote', output: 'OK' },
    functionCall({ type: 'local_shell_call', action: { type: 'exec', command: ['sh'] } }),
    { type: 'agent_message', author: 'host', recipient: 'agent', content: [] },
    { type: 'configuration_update', model: 'gpt-6.1-sol' }
  ])('rejects unknown calls, output mismatches, and unimplemented items %#', (item) =>
    refuse(body({ input: [functionCall(), item] }))
  )

  it('rejects reusing a call ID for another local function/custom or namespace', () => {
    refuse(body({ input: [functionCall(), customCall({ call_id: 'call-1' })] }))
  })

  it.each([
    { type: 'input_image', image_url: 'https://example.test/image.png' },
    { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
    { type: 'input_image', file_id: 'file-1' },
    { type: 'input_audio', audio_url: 'data:audio/wav;base64,AAAA' },
    { type: 'input_file', file_id: 'file-1' },
    { type: 'input_file', file_url: 'file:///etc/passwd' },
    { type: 'encrypted_content', encrypted_content: 'file-blob' },
    { type: 'input_text', text: 'ok', image_url: 'https://example.test' },
    {
      type: 'output_text',
      text: 'ok',
      annotations: [{ type: 'url_citation', url: 'https://example.test' }]
    }
  ])(
    'rejects all resource-bearing nested message and function/custom output content %#',
    (part) => {
      refuse(body({ input: [message([part])] }))
      for (const [call, type] of [
        [functionCall(), 'function_call_output'],
        [customCall(), 'custom_tool_call_output']
      ] as const) {
        refuse(
          body({
            input: [
              call,
              { type, call_id: call.call_id, output: [{ type: 'input_text', text: 'OK' }, part] }
            ]
          })
        )
      }
    }
  )
})

describe('task model policy: strict bounded JSON', () => {
  it.each([
    '{"model":"gpt-6.1-sol","model":"gpt-6.1-sol"}',
    '{"model":"gpt-6.1-sol","\\u006dodel":"gpt-6.1-sol"}',
    '{"__proto__":{}}',
    '{"input":{"prototype":{}}}',
    '{"tools":[{"parameters":{"constructor":{}}}]}',
    '{"input":1e1000}',
    '{"input":[]/*comment*/}',
    '{"input":[],}',
    '[1,2]',
    'null'
  ])('rejects malformed, duplicate, prototype, or non-finite JSON %#', (input) => {
    expect(() => createTaskModelPolicy(profile()).request(input)).toThrow(
      'TASK_MODEL_POLICY_REFUSED:'
    )
  })

  it('bounds depth before building the parse tree and does not mistake braces in text for structure', () => {
    const policy = createTaskModelPolicy(profile())
    expect(() => policy.request(`${'['.repeat(33)}0${']'.repeat(33)}`)).toThrow('STRUCTURE_LIMIT')
    expect(() => request(policy, body({ instructions: '{'.repeat(1000) }))).not.toThrow()
  })

  it('bounds structural tokens and total nodes before semantic validation', () => {
    expect(() =>
      createTaskModelPolicy(profile()).request(`[${Array(20_100).fill('0').join(',')}]`)
    ).toThrow('STRUCTURE_LIMIT')
    expect(() =>
      createTaskModelPolicy(profile()).request(
        `{${Array.from({ length: 7_000 }, (_, i) => `"key${i}":0`).join(',')}}`
      )
    ).toThrow('NODE_LIMIT')
  })

  it('enforces the 4 MiB UTF-8 body bound per dispatch and supports multiple valid bodies', () => {
    const policy = createTaskModelPolicy(profile())
    const payload = JSON.stringify(body({ instructions: 'a'.repeat(3 * 1024 * 1024) }))
    expect(() => policy.request(payload)).not.toThrow()
    expect(() => policy.request(payload)).not.toThrow()
    expect(() =>
      request(policy, body({ instructions: '码'.repeat(Math.ceil(TASK_MODEL_REQUEST_BYTES / 3)) }))
    ).toThrow('BYTES')
    expect(() => policy.request(' '.repeat(TASK_MODEL_REQUEST_BYTES + 1))).toThrow('BYTES')
  })

  it('bounds collection and identifier lengths', () => {
    refuse(body({ input: Array(513).fill(message()) }))
    refuse(body({ input: [functionCall({ call_id: 'x'.repeat(161) })] }))
    refuse(body({ input: [functionCall({ call_id: 'x\n' })] }))
  })
})

describe('task model policy: upstream SSE and opaque replay', () => {
  it('accepts pinned created, added, text/reasoning deltas, item done, and full completion usage/output', () => {
    const policy = createTaskModelPolicy(profile())
    const events = [
      {
        type: 'response.created',
        response: {
          id: 'resp-1',
          object: 'response',
          created_at: 1780000000,
          status: 'in_progress',
          output: [],
          usage: null,
          error: null,
          incomplete_details: null,
          background: false,
          user: null,
          metadata: {}
        }
      },
      { type: 'response.in_progress', sequence_number: 1, response: { id: 'resp-1' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: reasoning({ status: 'in_progress' })
      },
      {
        type: 'response.reasoning_summary_part.added',
        item_id: 'rs-1',
        output_index: 0,
        summary_index: 0,
        part: { type: 'summary_text', text: '' }
      },
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: 'rs-1',
        output_index: 0,
        summary_index: 0,
        delta: 'Check code'
      },
      {
        type: 'response.reasoning_summary_text.done',
        item_id: 'rs-1',
        output_index: 0,
        summary_index: 0,
        text: 'Check code'
      },
      { type: 'response.reasoning_text.delta', item_id: 'rs-1', content_index: 0, delta: 'Think' },
      {
        type: 'response.output_item.done',
        item: reasoning({
          summary: [{ type: 'summary_text', text: 'Checked' }],
          content: [{ type: 'reasoning_text', text: 'Thoughts' }],
          encrypted_content: 'opaque-1'
        })
      },
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: {
          type: 'message',
          id: 'msg-1',
          role: 'assistant',
          status: 'in_progress',
          content: []
        }
      },
      {
        type: 'response.content_part.added',
        item_id: 'msg-1',
        output_index: 1,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [], logprobs: [] }
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg-1',
        output_index: 1,
        content_index: 0,
        delta: 'Done'
      },
      {
        type: 'response.output_text.done',
        item_id: 'msg-1',
        output_index: 1,
        content_index: 0,
        text: 'Done'
      },
      {
        type: 'response.content_part.done',
        item_id: 'msg-1',
        output_index: 1,
        content_index: 0,
        part: { type: 'output_text', text: 'Done', annotations: [], logprobs: [] }
      },
      { type: 'response.output_item.done', output_index: 1, item: outputMessage() },
      completed()
    ]
    for (const event of events) {
      expect(() => send(policy, event)).not.toThrow()
    }
    expect(() =>
      request(policy, body({ input: [reasoning({ encrypted_content: 'opaque-1' }), message()] }))
    ).not.toThrow()
  })

  it('allows error text with URLs while enforcing the bounded failed-response structure', () => {
    const policy = createTaskModelPolicy(profile())
    expect(() =>
      send(policy, {
        type: 'response.failed',
        sequence_number: 3,
        response: {
          id: 'resp-failed',
          object: 'response',
          created_at: 1780000000,
          status: 'failed',
          background: false,
          user: null,
          metadata: {},
          usage: null,
          error: {
            code: 'rate_limit_exceeded',
            message: 'Try again; https://platform.openai.com/account/rate-limits'
          }
        }
      })
    ).not.toThrow()
    expect(() =>
      send(policy, { type: 'error', error: { code: 'server_error', message: 'Unavailable' } })
    ).not.toThrow()
  })

  it('accepts local function/custom SSE only when previously declared with matching call identities', () => {
    const policy = createTaskModelPolicy(profile())
    for (const call of [
      functionCall({ arguments: '', status: 'in_progress' }),
      customCall({ input: '', status: 'in_progress' })
    ]) {
      send(policy, { type: 'response.output_item.added', output_index: 0, item: call })
    }
    for (const event of [
      { type: 'response.function_call_arguments.delta', item_id: 'fc-1', delta: '{"command":' },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'fc-1',
        call_id: 'call-1',
        arguments: '{"command":"ls"}'
      },
      {
        type: 'response.custom_tool_call_input.delta',
        item_id: 'ct-1',
        call_id: 'call-2',
        delta: '*** Begin Patch'
      },
      {
        type: 'response.custom_tool_call_input.done',
        call_id: 'call-2',
        input: '*** Begin Patch\n*** End Patch'
      }
    ]) {
      expect(() => send(policy, event)).not.toThrow()
    }
    expect(() =>
      send(policy, {
        type: 'response.custom_tool_call_input.delta',
        item_id: 'ct-1',
        call_id: 'unknown',
        delta: 'patch'
      })
    ).toThrow('DELTA_CALL_UNPROVEN')
    expect(() =>
      send(policy, { type: 'response.function_call_arguments.delta', item_id: 'ct-1', delta: '{}' })
    ).toThrow('DELTA_CALL_UNPROVEN')
    expect(() =>
      send(policy, {
        type: 'response.function_call_arguments.done',
        item_id: 'fc-1',
        arguments: {},
        input: 'wrong kind'
      })
    ).toThrow('TASK_MODEL_POLICY_REFUSED:')
    expect(() =>
      request(
        policy,
        body({ input: [{ type: 'function_call_output', call_id: 'call-1', output: 'OK' }] })
      )
    ).not.toThrow()
  })

  it('supports approved custom namespace calls and prevents cross-namespace aliasing', () => {
    const named = { ...namespace, name: 'code' }
    const policy = createTaskModelPolicy(profile({ approvedTools: [named] }))
    send(policy, { type: 'response.output_item.done', item: functionCall({ namespace: 'code' }) })
    expect(() =>
      request(
        policy,
        body({
          tools: [named],
          input: [
            {
              type: 'function_call_output',
              call_id: 'call-1',
              name: 'exec_command',
              namespace: 'code',
              output: 'OK'
            }
          ]
        })
      )
    ).not.toThrow()
    expect(() =>
      request(
        policy,
        body({
          tools: [named],
          input: [
            {
              type: 'function_call_output',
              call_id: 'call-1',
              namespace: 'functions',
              output: 'OK'
            }
          ]
        })
      )
    ).toThrow('OUTPUT_CALL_MISMATCH')
  })

  it('only replays opaque reasoning observed in this policy and learns transactionally', () => {
    const policy = createTaskModelPolicy(profile())
    const replay = body({ input: [reasoning({ encrypted_content: 'opaque-1' }), message()] })
    expect(() => request(policy, replay)).toThrow('OPAQUE_REPLAY_UNPROVEN')
    send(
      policy,
      completed({ output: [reasoning({ encrypted_content: 'opaque-1' }), outputMessage()] })
    )
    expect(() => request(policy, replay)).not.toThrow()
    refuse(replay)
    expect(() =>
      send(
        policy,
        completed({
          output: [
            reasoning({ encrypted_content: 'not-observed' }),
            { type: 'web_search_call', action: { type: 'search', query: 'query' } }
          ]
        })
      )
    ).toThrow('TASK_MODEL_POLICY_REFUSED:')
    expect(() =>
      request(policy, body({ input: [reasoning({ encrypted_content: 'not-observed' })] }))
    ).toThrow('OPAQUE_REPLAY_UNPROVEN')
  })

  it('caps distinct opaque digests without allowing rejected output to authorize replay', () => {
    const policy = createTaskModelPolicy(profile())
    for (let i = 0; i < 128; i++) {
      send(policy, {
        type: 'response.output_item.done',
        item: reasoning({ encrypted_content: `opaque-${i}` })
      })
    }
    expect(() =>
      send(policy, {
        type: 'response.output_item.done',
        item: reasoning({ encrypted_content: 'opaque-over-limit' })
      })
    ).toThrow('REPLAY_LIMIT')
    expect(() =>
      request(policy, body({ input: [reasoning({ encrypted_content: 'opaque-over-limit' })] }))
    ).toThrow('OPAQUE_REPLAY_UNPROVEN')
  })

  it.each([
    {
      type: 'response.output_item.done',
      item: { type: 'web_search_call', action: { type: 'search', query: 'q' } }
    },
    { type: 'response.output_item.done', item: functionCall({ name: 'unapproved' }) },
    {
      type: 'response.output_item.done',
      item: {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'Done',
            annotations: [{ type: 'url_citation', url: 'https://example.test' }]
          }
        ]
      }
    },
    {
      type: 'response.content_part.added',
      part: { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }
    },
    { type: 'response.content_part.done', part: { type: 'output_audio', data: 'AAAA' } },
    { type: 'response.output_text.delta', delta: { type: 'image', file_id: 'file-1' } },
    { type: 'response.output_text.delta', delta: null },
    { type: 'response.output_text.delta', delta: 'ok', hosted_tool: { type: 'web_search' } },
    { type: 'response.output_text.delta', delta: 'ok', output_index: -1 },
    { type: 'response.function_call_arguments.delta', item_id: 'unknown', delta: '{}' },
    completed({ output: [{ type: 'image_generation_call', result: 'AAAA' }] }),
    completed({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_file', file_id: 'file-1' }]
        }
      ]
    }),
    completed({ usage: { input_tokens: 10, output_tokens: '4', total_tokens: 14 } }),
    completed({ usage: { input_tokens: 10, output_tokens: 4, total_tokens: -14 } }),
    completed({
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, model: 'different' }
    }),
    completed({ metadata: { account_id: 'secret' } }),
    completed({ usage_metadata: { actor: 'host' } }),
    completed({ end_turn: 'true' }),
    { type: 'response.metadata', headers: { 'x-openai-model': 'different' } },
    { type: 'response.metadata', headers: { authorization: 'forbidden' } },
    { type: 'response.metadata', metadata: { actor: 'host' } },
    { type: 'response.unknown', data: 'unknown' },
    { type: 'response.completed', response: { id: 'resp', error: { message: null } } }
  ])('refuses hosted/resources/unknown or wrongly typed upstream payloads %#', (event) => {
    expect(() => send(createTaskModelPolicy(profile()), event)).toThrow(
      'TASK_MODEL_POLICY_REFUSED:'
    )
  })

  it('applies strict JSON and byte limits to events and bounds cumulative upstream data', () => {
    const policy = createTaskModelPolicy(profile())
    expect(() =>
      policy.event('{"type":"response.output_text.delta","delta":"a","delta":"b"}')
    ).toThrow('DUPLICATE_KEY')
    expect(() => policy.event('[DONE]')).toThrow('JSON')
    expect(() =>
      policy.event(
        JSON.stringify({
          type: 'response.output_text.delta',
          delta: '码'.repeat(Math.ceil(TASK_MODEL_EVENT_BYTES / 3))
        })
      )
    ).toThrow('BYTES')
    const bounded = createTaskModelPolicy(profile())
    const chunk = JSON.stringify({ type: 'response.output_text.delta', delta: 'a'.repeat(900_000) })
    const rounds = Math.floor(TASK_MODEL_RESPONSE_BYTES / Buffer.byteLength(chunk))
    for (let i = 0; i < rounds; i++) {
      expect(() => bounded.event(chunk)).not.toThrow()
    }
    expect(() => bounded.event(chunk)).toThrow('RESPONSE_BYTES')
  })
})
