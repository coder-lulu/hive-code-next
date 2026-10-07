import {
  TASK_MODEL_EVENT_BYTES,
  TASK_MODEL_REQUEST_BYTES,
  TASK_MODEL_RESPONSE_BYTES
} from './task-model-channel-protocol'
import { createPolicyItems, type PolicyCall } from './task-model-policy-items'
import { addTaskModelPolicyLocation } from './task-model-stream-failure'
import { createTaskModelResponsePolicy } from './task-model-policy-response'
import {
  array,
  boolean,
  canonical,
  deny,
  error,
  headers,
  id,
  integer,
  isObject,
  object,
  oneOf,
  parse,
  part,
  strings,
  text
} from './task-model-policy-json'

export type TaskModelPolicyProfile = {
  model: string
  responsesLite: boolean
  approvedTools: readonly unknown[]
  reasoningEfforts: readonly string[]
  serviceTier?: string
}
export type TaskModelProfile = TaskModelPolicyProfile
const responseKinds =
  'response.created response.in_progress response.completed response.incomplete response.failed'.split(
    ' '
  )
const partKinds =
  'response.content_part.added response.content_part.done response.reasoning_summary_part.added response.reasoning_summary_part.done'.split(
    ' '
  )
const textKinds =
  'response.output_text.delta response.output_text.done response.reasoning_summary_text.delta response.reasoning_summary_text.done response.reasoning_text.delta'.split(
    ' '
  )
const callKinds =
  'response.function_call_arguments.delta response.function_call_arguments.done response.custom_tool_call_input.delta response.custom_tool_call_input.done'.split(
    ' '
  )
export function createTaskModelPolicy(profile: TaskModelPolicyProfile): {
  request: (jsonText: string) => string
  event: (dataText: string) => void
} {
  const model = id(profile.model),
    lite = profile.responsesLite,
    tier = profile.serviceTier
  boolean(lite)
  if (tier !== undefined) {
    id(tier)
  }
  const efforts = new Set(array([...profile.reasoningEfforts]).map(id))
  const { tools, item, opaque } = createPolicyItems(profile)
  let calls = new Map<string, PolicyCall>(),
    eventBytes = 0
  const response = createTaskModelResponsePolicy(model, item)
  return {
    request: (jsonText) => {
      const r = object(
        parse(jsonText, TASK_MODEL_REQUEST_BYTES),
        'model instructions input tools tool_choice parallel_tool_calls reasoning store stream include service_tier prompt_cache_key text client_metadata',
        'model input tool_choice parallel_tool_calls store stream include'
      )
      if (r.model !== model || r.store !== false || r.stream !== true || r.tool_choice !== 'auto') {
        deny('REQUEST_POLICY')
      }
      boolean(r.parallel_tool_calls)
      if (canonical(r.include) !== '["reasoning.encrypted_content"]') {
        deny('INCLUDE')
      }
      if (r.instructions !== undefined) {
        text(r.instructions)
      }
      if (r.service_tier !== undefined && r.service_tier !== tier) {
        deny('SERVICE_TIER')
      }
      if (
        lite &&
        (r.tools !== undefined ||
          r.parallel_tool_calls !== false ||
          (r.instructions && r.instructions !== ''))
      ) {
        deny('LITE_POLICY')
      }
      if (!lite) {
        tools(r.tools)
      }
      const inputs = array(r.input),
        next = new Map(calls)
      const additionalTools = (value: unknown): boolean =>
        isObject(value) && value.type === 'additional_tools'
      if (
        (lite && !additionalTools(inputs[0])) ||
        inputs.filter(additionalTools).length !== (lite ? 1 : 0)
      ) {
        deny('TOOL_PLACEMENT')
      }
      inputs.forEach((v) => item(v, next, new Set(), false))
      if (next.size > 1024) {
        deny('CALL_LIMIT')
      }
      if (efforts.size && r.reasoning == null) {
        deny('REASONING_EFFORT')
      }
      if (r.reasoning != null) {
        const reasoning = object(
          r.reasoning,
          'effort summary context',
          efforts.size ? 'effort' : ''
        )
        if (reasoning.effort !== undefined && !efforts.has(text(reasoning.effort))) {
          deny('REASONING_EFFORT')
        }
        if (reasoning.summary !== undefined) {
          oneOf(reasoning.summary, 'auto concise detailed none')
        }
        if (reasoning.context !== undefined) {
          oneOf(reasoning.context, 'current_turn all_turns')
        }
      }
      if (r.text !== undefined) {
        const t = object(r.text, 'verbosity')
        if (t.verbosity !== undefined) {
          oneOf(t.verbosity, 'low medium high')
        }
      }
      if (r.client_metadata !== undefined) {
        const metadata = object(
          r.client_metadata,
          'x-codex-installation-id session_id thread_id x-codex-window-id turn_id root_turn_id x-codex-turn-metadata'
        )
        strings(metadata, Object.keys(metadata).join(' '))
      }
      if (r.prompt_cache_key !== undefined) {
        text(r.prompt_cache_key, 8192)
      }
      delete r.client_metadata
      delete r.prompt_cache_key
      const result = canonical(r)
      if (Buffer.byteLength(result) > TASK_MODEL_REQUEST_BYTES) {
        deny('BYTES')
      }
      return result
    },
    event: (dataText) => {
      try {
        if (typeof dataText !== 'string') {
          deny('BYTES')
        }
        eventBytes += Buffer.byteLength(dataText)
        if (eventBytes > TASK_MODEL_RESPONSE_BYTES) {
          deny('RESPONSE_BYTES')
        }
        const e = object(
          parse(dataText, TASK_MODEL_EVENT_BYTES),
          'type sequence_number output_index item_id call_id content_index summary_index response item delta text part arguments input error headers metadata',
          'type'
        )
        for (const key of ['sequence_number', 'output_index', 'content_index', 'summary_index']) {
          if (e[key] !== undefined) {
            integer(e[key])
          }
        }
        for (const key of ['item_id', 'call_id']) {
          if (e[key] !== undefined) {
            id(e[key])
          }
        }
        const kind = text(e.type),
          learned = new Set<string>()
        let next = calls
        const prefix = 'type sequence_number '
        if (responseKinds.includes(kind)) {
          object(e, `${prefix}response`, 'response')
          next = new Map(calls)
          response(e.response, next, learned, kind === 'response.completed')
        } else if (['response.output_item.added', 'response.output_item.done'].includes(kind)) {
          object(e, `${prefix}output_index item`, 'item')
          next = new Map(calls)
          item(e.item, next, learned, true)
        } else if (partKinds.includes(kind)) {
          object(e, `${prefix}output_index item_id content_index summary_index part`, 'part')
          part(
            e.part,
            kind.includes('summary') ? 'summary_text' : 'output_text reasoning_text text'
          )
        } else if (textKinds.includes(kind)) {
          const field = kind.endsWith('.delta') ? 'delta' : 'text'
          object(e, `${prefix}output_index item_id content_index summary_index ${field}`, field)
          text(e[field])
        } else if (callKinds.includes(kind)) {
          const functional = kind.includes('function'),
            field = kind.endsWith('.delta') ? 'delta' : functional ? 'arguments' : 'input'
          object(e, `${prefix}output_index item_id call_id ${field}`, field)
          text(e[field])
          const candidates = [...calls.entries()].filter(
            ([callId, call]) =>
              (e.call_id !== undefined || e.item_id !== undefined) &&
              (e.call_id === undefined || callId === e.call_id) &&
              (e.item_id === undefined || call.itemId === e.item_id)
          )
          if (
            candidates.length !== 1 ||
            candidates[0][1].kind !== (functional ? 'function' : 'custom')
          ) {
            deny('DELTA_CALL_UNPROVEN')
          }
        } else if (kind === 'response.metadata') {
          object(e, `${prefix}headers metadata`)
          if (e.headers !== undefined) {
            headers(e.headers, model)
          }
          if (e.metadata !== undefined) {
            object(e.metadata, '')
          }
        } else if (kind === 'error') {
          object(e, `${prefix}error`, 'error')
          error(e.error)
        } else {
          deny('EVENT_UNSUPPORTED')
        }
        if (next.size > 1024 || (learned.size && new Set([...opaque, ...learned]).size > 128)) {
          deny('REPLAY_LIMIT')
        }
        calls = next
        learned.forEach((hash) => opaque.add(hash))
      } catch (error) {
        addTaskModelPolicyLocation(error, 'event')
        throw error
      }
    }
  }
}
