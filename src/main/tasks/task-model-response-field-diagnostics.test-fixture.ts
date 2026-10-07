// Public Response declarations plus the documented store request field; names only.
export const publicTaskModelResponseFields = [
  'id',
  'access_programs',
  'created_at',
  'error',
  'incomplete_details',
  'instructions',
  'metadata',
  'model',
  'object',
  'output',
  'parallel_tool_calls',
  'temperature',
  'tool_choice',
  'tools',
  'top_p',
  'background',
  'completed_at',
  'conversation',
  'max_output_tokens',
  'max_tool_calls',
  'moderation',
  'previous_response_id',
  'prompt',
  'prompt_cache_diagnostics',
  'prompt_cache_key',
  'prompt_cache_options',
  'prompt_cache_retention',
  'reasoning',
  'safety_identifier',
  'service_tier',
  'status',
  'store',
  'text',
  'top_logprobs',
  'truncation',
  'usage',
  'user'
] as const

export const refusedTaskModelResponseFields = publicTaskModelResponseFields.filter(
  (field) =>
    !'id object created_at status model output usage error incomplete_details background user metadata'
      .split(' ')
      .includes(field)
)
