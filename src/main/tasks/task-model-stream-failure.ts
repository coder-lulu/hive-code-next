const streamReasons = [
  'utf8',
  'json',
  'field',
  'id_field',
  'retry_field',
  'event_type',
  'event_name',
  'duplicate_event_name',
  'event_limit',
  'event_size',
  'line_limit',
  'response_id',
  'response_order',
  'terminal',
  'no_events',
  'queue_limit',
  'queue_state',
  'policy'
] as const
export type TaskModelStreamReason = (typeof streamReasons)[number]
const policyReasons = [
  'ADDITIONAL_TOOLS',
  'ARRAY',
  'BOOLEAN',
  'BYTES',
  'CALL_LIMIT',
  'CALL_MISMATCH',
  'CALL_UNAPPROVED',
  'CONTENT_METADATA_UNSUPPORTED',
  'DEFERRED_TOOL_UNSUPPORTED',
  'DELTA_CALL_UNPROVEN',
  'DUPLICATE_KEY',
  'ENUM',
  'EVENT_UNSUPPORTED',
  'EXTERNAL_REFERENCE',
  'HEADER',
  'IDENTIFIER',
  'INCLUDE',
  'INTEGER',
  'ITEM_UNSUPPORTED',
  'JSON',
  'LITE_POLICY',
  'NODE_LIMIT',
  'NUMBER',
  'OBJECT',
  'OPAQUE_REPLAY_UNPROVEN',
  'OUTPUT_CALL_MISMATCH',
  'PROTOTYPE_KEY',
  'REASONING_EFFORT',
  'REPLAY_LIMIT',
  'REQUEST_POLICY',
  'REQUIRED_FIELD',
  'RESPONSE_BYTES',
  'RESPONSE_IDENTITY',
  'RESPONSE_METADATA',
  'RESPONSE_TERMINAL_STATE',
  'SERVICE_TIER',
  'STATUS',
  'STRING',
  'STRUCTURE_LIMIT',
  'TOOL_COLLISION',
  'TOOL_DEFINITION_CHANGED',
  'TOOL_PLACEMENT',
  'TOOL_UNAPPROVED',
  'TOOL_UNSUPPORTED',
  'UNKNOWN_FIELD',
  'USAGE_METADATA_UNSUPPORTED',
  'USAGE_UNITS'
] as const
export type TaskModelPolicyReason = (typeof policyReasons)[number]
const locations = [
  'event',
  'response',
  'response_metadata',
  'incomplete_details',
  'usage',
  'item',
  'part',
  'error',
  'headers'
] as const
export type TaskModelPolicyLocation = (typeof locations)[number]
// Names only; diagnostic labels do not admit response fields.
const keys = [
  'safety_buffering',
  'usage_metadata',
  'model',
  'id',
  'access_programs',
  'created_at',
  'error',
  'incomplete_details',
  'instructions',
  'metadata',
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
  'user',
  'other'
] as const
export type TaskModelPolicyKey = (typeof keys)[number]
export type TaskModelStreamDiagnostic = Readonly<{
  streamReason: TaskModelStreamReason
  policyReason?: TaskModelPolicyReason
  policyLocation?: TaskModelPolicyLocation
  policyKey?: TaskModelPolicyKey
}>
// Error producer provenance only; no execution, reader or authorization state lives here.
const produced = new WeakMap<object, TaskModelStreamDiagnostic>()

export function taskModelStreamDiagnostic(error: unknown): TaskModelStreamDiagnostic | undefined {
  return typeof error === 'object' && error !== null ? produced.get(error) : undefined
}
export function markTaskModelStreamFailure(error: unknown, reason: TaskModelStreamReason): void {
  const known = streamReasons.find((value) => value === reason)
  if (known && typeof error === 'object' && error !== null) {
    produced.set(error, Object.freeze({ streamReason: known }))
  }
}
export function taskModelStreamRefusal(reason: TaskModelStreamReason): Error {
  const error = new Error('TASK_MODEL_STREAM_REFUSED')
  markTaskModelStreamFailure(error, reason)
  return error
}
export function taskModelPolicyRefusal(reason: string, key?: TaskModelPolicyKey): Error {
  const error = new Error(`TASK_MODEL_POLICY_REFUSED:${reason}`)
  const known = policyReasons.find((value) => value === reason)
  const knownKey = keys.find((value) => value === key)
  if (known) {
    produced.set(
      error,
      Object.freeze({
        streamReason: 'policy',
        policyReason: known,
        ...(knownKey ? { policyKey: knownKey } : {})
      })
    )
  }
  return error
}
export function addTaskModelPolicyLocation(
  error: unknown,
  location: TaskModelPolicyLocation
): void {
  const proof = taskModelStreamDiagnostic(error)
  const known = locations.find((value) => value === location)
  if (
    proof?.streamReason === 'policy' &&
    !proof.policyLocation &&
    known &&
    typeof error === 'object' &&
    error !== null
  ) {
    produced.set(error, Object.freeze({ ...proof, policyLocation: known }))
  }
}
export function taskModelRefusedPolicyKey(key: string): TaskModelPolicyKey {
  return keys.find((value) => value === key) ?? 'other'
}
