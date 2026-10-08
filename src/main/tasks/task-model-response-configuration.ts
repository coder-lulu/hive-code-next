import { createHash } from 'node:crypto'
import catalog from '../../../integration/paperclip/runtime/hive-models.json'
import provenance from '../../../integration/paperclip/runtime/catalog-provenance.json'
import { TASK_MODEL_REQUEST_BYTES } from './task-model-channel-protocol'
import {
  array,
  boolean,
  digest,
  id,
  integer,
  object,
  oneOf,
  parse,
  text,
  deny,
  type PolicyObject
} from './task-model-policy-json'
import { addTaskModelPolicyLocation, taskModelRefusedPolicyKey } from './task-model-stream-failure'
import { taskModelResponseToolInventoryDigest } from './task-model-response-tool-inventory'

export const TASK_MODEL_RESPONSE_CONFIGURATION_FIELDS =
  'access_programs instructions parallel_tool_calls temperature tool_choice tools top_p completed_at conversation max_output_tokens max_tool_calls moderation previous_response_id prompt reasoning service_tier store text truncation prompt_cache_key prompt_cache_retention top_logprobs prompt_cache_diagnostics prompt_cache_options safety_identifier frequency_penalty presence_penalty'

export type TaskModelResponseConfiguration = Readonly<{
  echoes: Readonly<Record<string, string>>
  toolDigests: readonly string[]
  tiers: readonly string[]
}>

/** Created only for an admitted reader; no prompt/input copy or authority is retained. */
export function captureTaskModelResponseConfiguration(
  body: string,
  model: string,
  lite: boolean
): TaskModelResponseConfiguration {
  const request = object(
    parse(body, TASK_MODEL_REQUEST_BYTES),
    'model instructions input tools tool_choice parallel_tool_calls reasoning store stream include service_tier text',
    'model input'
  )
  const reasoning =
    request.reasoning == null ? {} : object(request.reasoning, 'effort summary context')
  const controls = request.text == null ? {} : object(request.text, 'verbosity')
  let defaultVerbosity: string | null = null
  if (model === provenance.model) {
    if (
      createHash('sha256').update(JSON.stringify(catalog)).digest('hex') !==
      provenance.catalogSha256
    ) {
      deny('RESPONSE_METADATA')
    }
    defaultVerbosity =
      catalog.models.find((entry) => entry.slug === model)?.default_verbosity ?? null
  }
  const expectedTools = lite
    ? object(array(request.input)[0], 'type id role tools', 'tools').tools
    : request.tools
  const summary = reasoning.summary === 'none' ? null : (reasoning.summary ?? null)
  return Object.freeze({
    echoes: Object.freeze({
      instructions: digest(request.instructions ?? ''),
      parallel_tool_calls: digest(request.parallel_tool_calls),
      tool_choice: digest(request.tool_choice),
      store: digest(request.store),
      effort: digest(reasoning.effort ?? null),
      summary: digest(summary),
      generate_summary: digest(summary),
      context: digest(reasoning.context ?? (lite ? 'all_turns' : null)),
      verbosity: digest(controls.verbosity ?? defaultVerbosity)
    }),
    toolDigests: Object.freeze(
      lite
        ? [digest([]), taskModelResponseToolInventoryDigest(expectedTools)]
        : [taskModelResponseToolInventoryDigest(expectedTools)]
    ),
    tiers: Object.freeze(
      request.service_tier == null || request.service_tier === 'auto'
        ? ['auto', 'default']
        : [text(request.service_tier)]
    )
  })
}

function refused(key: string): never {
  return deny('RESPONSE_CONFIGURATION', taskModelRefusedPolicyKey(key))
}
function matches(
  config: TaskModelResponseConfiguration | undefined,
  key: string,
  value: unknown,
  field = key
): void {
  if (!config || digest(value) !== config.echoes[key]) {
    refused(field)
  }
}
function boundedNumber(value: unknown, maximum: number, key: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    refused(key)
  }
}

export function validateTaskModelResponseConfiguration(
  response: PolicyObject,
  completed: boolean,
  config?: TaskModelResponseConfiguration
): void {
  for (const key of ['frequency_penalty', 'presence_penalty']) {
    if (Object.hasOwn(response, key) && response[key] !== 0) {
      refused(key)
    }
  }
  if (response.access_programs != null) {
    try {
      const programs = object(response.access_programs, 'cyber', 'cyber')
      oneOf(programs.cyber, 'standard daybreak_blue daybreak_red')
    } catch (error) {
      addTaskModelPolicyLocation(error, 'response_access_programs')
      throw error
    }
  }
  for (const key of [
    'conversation',
    'previous_response_id',
    'prompt',
    'moderation',
    'prompt_cache_diagnostics',
    'prompt_cache_options'
  ]) {
    if (response[key] != null) {
      refused(key)
    }
  }
  if (
    response.prompt_cache_retention != null &&
    response.prompt_cache_retention !== 'in_memory' &&
    response.prompt_cache_retention !== '24h'
  ) {
    refused('prompt_cache_retention')
  }
  for (const [key, maximum] of [
    ['prompt_cache_key', 160],
    ['safety_identifier', 128]
  ] as const) {
    if (response[key] != null) {
      try {
        const value = text(response[key], maximum)
        id(value)
        if (
          [...value].some((character) => {
            const code = character.charCodeAt(0)
            return code >= 127 && code <= 159
          })
        ) {
          refused(key)
        }
      } catch {
        refused(key)
      }
    }
  }
  for (const key of ['parallel_tool_calls', 'store']) {
    if (response[key] !== undefined) {
      boolean(response[key])
      matches(config, key, response[key])
    }
  }
  if (response.tool_choice !== undefined) {
    oneOf(response.tool_choice, 'auto')
    matches(config, 'tool_choice', response.tool_choice)
  }
  if (response.instructions != null) {
    text(response.instructions)
    matches(config, 'instructions', response.instructions)
  }
  if (response.tools !== undefined) {
    array(response.tools)
    if (!config?.toolDigests.includes(taskModelResponseToolInventoryDigest(response.tools))) {
      refused('tools')
    }
  }
  if (response.reasoning != null) {
    try {
      const reasoning = object(response.reasoning, 'effort summary context generate_summary mode')
      if (reasoning.mode != null && reasoning.mode !== 'standard') {
        refused('reasoning')
      }
      for (const key of ['effort', 'summary', 'context', 'generate_summary']) {
        if (reasoning[key] != null) {
          text(reasoning[key], 32)
          matches(
            config,
            key,
            reasoning[key] === 'none' && key !== 'effort' && key !== 'context'
              ? null
              : reasoning[key],
            'reasoning'
          )
        }
      }
    } catch (error) {
      addTaskModelPolicyLocation(error, 'response_reasoning')
      throw error
    }
  }
  if (response.text != null) {
    try {
      const controls = object(response.text, 'format verbosity')
      if (controls.format != null) {
        try {
          const format = object(controls.format, 'type', 'type')
          oneOf(format.type, 'text')
        } catch (error) {
          addTaskModelPolicyLocation(error, 'response_text_format')
          throw error
        }
      }
      if (controls.verbosity != null) {
        oneOf(controls.verbosity, 'low medium high')
        matches(config, 'verbosity', controls.verbosity, 'text')
      }
    } catch (error) {
      addTaskModelPolicyLocation(error, 'response_text')
      throw error
    }
  }
  if (response.service_tier != null) {
    if (!config?.tiers.includes(text(response.service_tier, 32))) {
      refused('service_tier')
    }
  }
  if (response.completed_at != null) {
    if (!completed) {
      refused('completed_at')
    }
    boundedNumber(response.completed_at, Number.MAX_SAFE_INTEGER, 'completed_at')
  }
  for (const [key, maximum] of [
    ['temperature', 2],
    ['top_p', 1]
  ] as const) {
    if (response[key] != null) {
      boundedNumber(response[key], maximum, key)
    }
  }
  for (const key of ['max_output_tokens', 'max_tool_calls', 'top_logprobs']) {
    if (response[key] != null) {
      integer(response[key])
      boundedNumber(response[key], key === 'top_logprobs' ? 20 : 2 ** 31 - 1, key)
    }
  }
  if (response.truncation != null) {
    oneOf(response.truncation, 'disabled')
  }
}
