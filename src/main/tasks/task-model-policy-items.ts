import type { TaskModelPolicyProfile } from './task-model-policy'
import { TASK_MODEL_EVENT_BYTES, TASK_MODEL_REQUEST_BYTES } from './task-model-channel-protocol'
import { addTaskModelPolicyLocation } from './task-model-stream-failure'
import {
  array,
  boolean,
  deny,
  digest,
  id,
  object,
  oneOf,
  parse,
  part,
  record,
  references,
  strings,
  text
} from './task-model-policy-json'

export type PolicyCall = { kind: string; name: string; namespace: string; itemId?: string }
const toolKey = (namespace: string, name: string): string => JSON.stringify([namespace, name])
export function createPolicyItems(profile: TaskModelPolicyProfile): {
  tools: (value: unknown) => void
  item: (
    value: unknown,
    calls: Map<string, PolicyCall>,
    learned: Set<string>,
    upstream: boolean
  ) => void
  opaque: Set<string>
} {
  const approved = new Set<string>(),
    inventory = new Map<string, string>(),
    opaque = new Set<string>()
  const lite = profile.responsesLite
  const tool = (value: unknown, seen: Set<string>, namespace?: string, learning = false): void => {
    const t = object(
      value,
      'type name description tools strict parameters format defer_loading',
      'type name description'
    )
    const kind = text(t.type),
      name = id(t.name)
    text(t.description)
    if (kind === 'namespace' && namespace === undefined) {
      object(t, 'type name description tools', 'tools')
      array(t.tools).forEach((child) => tool(child, seen, name, learning))
    } else if (kind === 'function' || kind === 'custom') {
      object(
        t,
        kind === 'function'
          ? 'type name description strict parameters defer_loading'
          : 'type name description format defer_loading',
        kind === 'function' ? 'strict parameters' : 'format'
      )
      if (t.defer_loading !== undefined && t.defer_loading !== false) {
        deny('DEFERRED_TOOL_UNSUPPORTED')
      }
      if (kind === 'function') {
        boolean(t.strict)
        record(t.parameters)
        references(t.parameters)
      } else {
        const format = object(t.format, 'type syntax definition', 'type syntax definition')
        strings(format, 'type syntax definition')
      }
      const key = toolKey(namespace ?? 'functions', name)
      if (seen.has(key)) {
        deny('TOOL_COLLISION')
      }
      seen.add(key)
      if (learning) {
        inventory.set(key, kind)
      } else if (inventory.get(key) !== kind) {
        deny('TOOL_UNAPPROVED')
      }
    } else {
      deny('TOOL_UNSUPPORTED')
    }
    if (namespace === undefined) {
      const hash = digest(t)
      if (learning) {
        if (approved.has(hash)) {
          deny('TOOL_COLLISION')
        }
        approved.add(hash)
      } else if (!approved.has(hash)) {
        deny('TOOL_DEFINITION_CHANGED')
      }
    }
  }
  const trusted = array(parse(JSON.stringify(profile.approvedTools), TASK_MODEL_REQUEST_BYTES))
  const trustedSeen = new Set<string>()
  trusted.forEach((t) => tool(t, trustedSeen, undefined, true))
  const tools = (value: unknown): void => {
    const seen = new Set<string>(),
      roots = new Set<string>()
    array(value).forEach((t) => {
      const hash = digest(t)
      if (roots.has(hash)) {
        deny('TOOL_COLLISION')
      }
      roots.add(hash)
      tool(t, seen)
    })
  }
  const item = (
    value: unknown,
    calls: Map<string, PolicyCall>,
    learned: Set<string>,
    upstream: boolean
  ): void => {
    try {
      const v = object(
        value,
        'type id role content phase summary encrypted_content tools name namespace arguments input call_id status output',
        'type'
      )
      const kind = text(v.type)
      if (v.id != null) {
        id(v.id)
      }
      if (v.status !== undefined && !(kind === 'custom_tool_call' && v.status === null)) {
        if (!upstream && kind !== 'custom_tool_call') {
          deny('STATUS')
        }
        oneOf(v.status, 'in_progress completed incomplete failed')
      }
      if (kind === 'message') {
        object(
          v,
          upstream ? 'type id role content phase status' : 'type id role content phase',
          'role content'
        )
        oneOf(v.role, upstream ? 'assistant' : 'user assistant developer system')
        if (v.phase != null) {
          oneOf(v.phase, 'commentary final_answer')
        }
        array(v.content).forEach((p) =>
          part(p, upstream ? 'output_text' : 'input_text output_text')
        )
      } else if (kind === 'reasoning') {
        object(
          v,
          upstream
            ? 'type id summary content encrypted_content status'
            : 'type id summary content encrypted_content',
          'summary'
        )
        array(v.summary).forEach((p) => part(p, 'summary_text'))
        if (v.content != null) {
          array(v.content).forEach((p) => part(p, 'reasoning_text text'))
        }
        if (v.encrypted_content != null) {
          const hash = digest(text(v.encrypted_content, TASK_MODEL_EVENT_BYTES))
          if (upstream) {
            learned.add(hash)
          } else if (!opaque.has(hash)) {
            deny('OPAQUE_REPLAY_UNPROVEN')
          }
        }
      } else if (kind === 'additional_tools') {
        object(v, 'type id role tools', 'role tools')
        if (upstream || !lite || v.role !== 'developer') {
          deny('ADDITIONAL_TOOLS')
        }
        tools(v.tools)
      } else if (kind === 'function_call' || kind === 'custom_tool_call') {
        const functional = kind === 'function_call'
        object(
          v,
          `${functional ? 'type id name namespace arguments call_id' : 'type id name namespace input call_id status'}${upstream && functional ? ' status' : ''}`,
          'name call_id'
        )
        const call: PolicyCall = {
          kind: functional ? 'function' : 'custom',
          name: id(v.name),
          namespace: v.namespace == null ? 'functions' : id(v.namespace),
          ...(v.id ? { itemId: id(v.id) } : {})
        }
        if (inventory.get(toolKey(call.namespace, call.name)) !== call.kind) {
          deny('CALL_UNAPPROVED')
        }
        text(functional ? v.arguments : v.input)
        const callId = id(v.call_id),
          prior = calls.get(callId)
        if (
          prior &&
          (prior.kind !== call.kind ||
            prior.name !== call.name ||
            prior.namespace !== call.namespace ||
            (prior.itemId && call.itemId && prior.itemId !== call.itemId))
        ) {
          deny('CALL_MISMATCH')
        }
        if (
          call.itemId &&
          [...calls.entries()].some(
            ([key, other]) => key !== callId && other.itemId === call.itemId
          )
        ) {
          deny('CALL_MISMATCH')
        }
        calls.set(callId, { ...call, itemId: call.itemId ?? prior?.itemId })
      } else if (kind === 'function_call_output' || kind === 'custom_tool_call_output') {
        object(
          v,
          kind === 'function_call_output'
            ? 'type id name namespace call_id output'
            : 'type id name call_id output',
          'call_id output'
        )
        const call = calls.get(id(v.call_id))
        if (
          !call ||
          call.kind !== (kind === 'function_call_output' ? 'function' : 'custom') ||
          (v.name != null && v.name !== call.name) ||
          (v.namespace != null && v.namespace !== call.namespace)
        ) {
          deny('OUTPUT_CALL_MISMATCH')
        }
        if (typeof v.output === 'string') {
          text(v.output)
        } else {
          array(v.output).forEach((p) => part(p, 'input_text'))
        }
      } else {
        deny('ITEM_UNSUPPORTED')
      }
    } catch (error) {
      addTaskModelPolicyLocation(error, 'item')
      throw error
    }
  }
  return { tools, item, opaque }
}
