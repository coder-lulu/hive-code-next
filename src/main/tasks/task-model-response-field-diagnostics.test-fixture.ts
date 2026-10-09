import { taskFailure } from './task-failure-diagnostic'
import {
  addTaskModelPolicyLocation,
  taskModelPolicyRefusal,
  taskModelRefusedPolicyKey,
  type TaskModelPolicyKey
} from './task-model-stream-failure'

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

// These test call surfaces retain the real producer function identity while admitting
// deliberately invalid diagnostic values. They do not coerce getters, proxies or boxed inputs.
type InvalidPolicyKeyInput = (key: unknown) => TaskModelPolicyKey
type InvalidPolicyRefusalInput = (reason: string, key?: unknown) => Error
type InvalidPolicyLocationInput = (error: unknown, location: unknown) => void
type InvalidFailureDiagnosticsInput = (
  error: Parameters<typeof taskFailure>[0],
  phase: Parameters<typeof taskFailure>[1],
  fallback: Parameters<typeof taskFailure>[2],
  httpStatus?: number,
  responseReason?: unknown,
  contentTypeKind?: unknown
) => ReturnType<typeof taskFailure>

export const taskModelRefusedPolicyKeyWithInvalidInput =
  taskModelRefusedPolicyKey as InvalidPolicyKeyInput
export const taskModelPolicyRefusalWithInvalidInput =
  taskModelPolicyRefusal as InvalidPolicyRefusalInput
export const addTaskModelPolicyLocationWithInvalidInput =
  addTaskModelPolicyLocation as InvalidPolicyLocationInput
export const taskFailureWithInvalidDiagnostics = taskFailure as InvalidFailureDiagnosticsInput
