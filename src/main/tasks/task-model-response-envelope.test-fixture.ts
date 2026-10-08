import { taskDockerModelProfile } from './task-docker-model-profile'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { modelEvent } from './task-model-broker.test-fixture'

export function controlledTaskModelResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'resp-fixture',
    object: 'response',
    model: taskDockerModelProfile().model,
    created_at: Math.floor(TASK_TEST_NOW / 1000),
    status: 'in_progress',
    output: [],
    access_programs: { cyber: 'standard' },
    completed_at: null,
    instructions: null,
    parallel_tool_calls: false,
    temperature: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    tool_choice: 'auto',
    tools: [],
    tool_usage: {
      image_gen: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_tokens_details: { image_tokens: 0, text_tokens: 0 },
        output_tokens_details: { image_tokens: 0, text_tokens: 0 }
      },
      web_search: { num_requests: 0 }
    },
    top_p: 1,
    conversation: null,
    max_output_tokens: null,
    max_tool_calls: null,
    moderation: null,
    previous_response_id: null,
    prompt: null,
    reasoning: {
      effort: 'low',
      context: 'all_turns',
      summary: null,
      generate_summary: null,
      mode: 'standard'
    },
    service_tier: 'default',
    store: false,
    text: { format: { type: 'text' }, verbosity: 'low' },
    truncation: 'disabled',
    prompt_cache_key: 'fixture-cache',
    prompt_cache_retention: '24h',
    prompt_cache_diagnostics: null,
    prompt_cache_options: null,
    safety_identifier: 'fixture-safety',
    top_logprobs: 0,
    error: null,
    incomplete_details: null,
    metadata: {},
    usage: null,
    ...overrides
  }
}

export const controlledTaskModelResponseStream = (overrides: Record<string, unknown> = {}) =>
  modelEvent('response.created', { response: controlledTaskModelResponse(overrides) }) +
  modelEvent('response.output_text.delta', { delta: 'Synthetic 中文🙂' }) +
  modelEvent('response.completed', {
    response: controlledTaskModelResponse({
      status: 'completed',
      completed_at: TASK_TEST_NOW / 1000,
      ...overrides
    })
  })

export function controlledTaskModelRequest(bodyBase64: string) {
  const request: Record<string, unknown> = JSON.parse(Buffer.from(bodyBase64, 'base64').toString())
  request.text = { verbosity: 'low' }
  return Buffer.from(JSON.stringify(request)).toString('base64')
}
