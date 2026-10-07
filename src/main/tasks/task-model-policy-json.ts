import { createHash } from 'node:crypto'
import { parseTree, type Node } from 'jsonc-parser'
import { assertJsonTextStructureWithinLimits } from '../../shared/json-text-structure-limit'
import { TASK_MODEL_REQUEST_BYTES } from './task-model-channel-protocol'
import {
  addTaskModelPolicyLocation,
  taskModelPolicyRefusal,
  taskModelRefusedPolicyKey,
  type TaskModelPolicyKey
} from './task-model-stream-failure'

export type PolicyObject = Record<string, unknown>
export function usage(value: unknown): void {
  try {
    const u = object(
      value,
      'input_tokens output_tokens total_tokens input_tokens_details output_tokens_details codex_rollout_budget_units',
      'input_tokens output_tokens total_tokens'
    )
    for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
      integer(u[key])
    }
    for (const key of ['input_tokens_details', 'output_tokens_details']) {
      if (u[key] != null) {
        const input = key === 'input_tokens_details'
        const d = object(
          u[key],
          input ? 'cached_tokens cache_write_tokens' : 'reasoning_tokens',
          input ? 'cached_tokens' : 'reasoning_tokens'
        )
        Object.values(d).forEach(integer)
      }
    }
    if (
      u.codex_rollout_budget_units != null &&
      (typeof u.codex_rollout_budget_units !== 'number' ||
        !Number.isFinite(u.codex_rollout_budget_units) ||
        u.codex_rollout_budget_units < 0)
    ) {
      deny('USAGE_UNITS')
    }
  } catch (error) {
    addTaskModelPolicyLocation(error, 'usage')
    throw error
  }
}
export function error(value: unknown): void {
  try {
    const e = object(value, 'code message type param', 'message')
    text(e.message)
    for (const key of ['code', 'type', 'param']) {
      if (e[key] != null) {
        text(e[key])
      }
    }
  } catch (error) {
    addTaskModelPolicyLocation(error, 'error')
    throw error
  }
}
export function headers(value: unknown, model: string): void {
  try {
    const h = record(value)
    for (const [name, content] of Object.entries(h)) {
      const lower = name.toLowerCase()
      oneOf(lower, 'openai-model x-openai-model x-codex-turn-state')
      const values = typeof content === 'string' ? [content] : array(content)
      if (values.length === 0) {
        deny('HEADER')
      }
      values.forEach((v) => text(v, 8192))
      if (lower !== 'x-codex-turn-state' && values.some((v) => v !== model)) {
        deny('RESPONSE_IDENTITY')
      }
    }
  } catch (error) {
    addTaskModelPolicyLocation(error, 'headers')
    throw error
  }
}
export function deny(reason: string, key?: TaskModelPolicyKey): never {
  throw taskModelPolicyRefusal(reason, key)
}
export function isObject(value: unknown): value is PolicyObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function record(value: unknown): PolicyObject {
  if (!isObject(value)) {
    deny('OBJECT')
  }
  return value
}
export function object(value: unknown, allowed: string, required = ''): PolicyObject {
  const result = record(value)
  const keys = allowed.split(' ').filter(Boolean)
  const unknownKey = Object.keys(result).find((key) => !keys.includes(key))
  if (unknownKey !== undefined) {
    deny('UNKNOWN_FIELD', taskModelRefusedPolicyKey(unknownKey))
  }
  if (
    required
      .split(' ')
      .filter(Boolean)
      .some((key) => !Object.hasOwn(result, key))
  ) {
    deny('REQUIRED_FIELD')
  }
  return result
}
export function text(value: unknown, maximum = TASK_MODEL_REQUEST_BYTES): string {
  if (typeof value !== 'string' || value.length > maximum) {
    deny('STRING')
  }
  return value
}
export function id(value: unknown): string {
  const result = text(value, 160)
  if (!result || [...result].some((character) => character.charCodeAt(0) < 32)) {
    deny('IDENTIFIER')
  }
  return result
}
export function integer(value: unknown): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    deny('INTEGER')
  }
}
export function boolean(value: unknown): void {
  if (typeof value !== 'boolean') {
    deny('BOOLEAN')
  }
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 512) {
    deny('ARRAY')
  }
  return value
}
export function strings(value: PolicyObject, keys: string): void {
  for (const key of keys.split(' ')) {
    if (Object.hasOwn(value, key)) {
      text(value[key])
    }
  }
}
export function oneOf(value: unknown, choices: string): void {
  if (!choices.split(' ').includes(text(value))) {
    deny('ENUM')
  }
}
export function parse(textValue: string, maximum: number): unknown {
  if (typeof textValue !== 'string' || Buffer.byteLength(textValue) > maximum) {
    deny('BYTES')
  }
  try {
    assertJsonTextStructureWithinLimits(textValue, { structuralTokens: 20_000, nestingDepth: 32 })
  } catch {
    deny('STRUCTURE_LIMIT')
  }
  const errors: { error: number; offset: number; length: number }[] = []
  const tree = parseTree(textValue, errors, { allowTrailingComma: false, disallowComments: true })
  if (!tree || errors.length) {
    deny('JSON')
  }
  let nodes = 0
  const visit = (node: Node): void => {
    if (++nodes > 20_000) {
      deny('NODE_LIMIT')
    }
    if (node.type === 'number' && !Number.isFinite(node.value)) {
      deny('NUMBER')
    }
    if (node.type === 'object') {
      const seen = new Set<string>()
      for (const property of node.children ?? []) {
        const name: unknown = property.children?.[0]?.value
        if (typeof name !== 'string') {
          deny('JSON')
        }
        if (seen.has(name)) {
          deny('DUPLICATE_KEY')
        }
        if (['__proto__', 'constructor', 'prototype'].includes(name)) {
          deny('PROTOTYPE_KEY')
        }
        seen.add(name)
      }
    }
    for (const child of node.children ?? []) {
      visit(child)
    }
  }
  visit(tree)
  const result: unknown = JSON.parse(textValue)
  return result
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
export const digest = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex')
export function references(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(references)
    return
  }
  if (!value || typeof value !== 'object') {
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (['$ref', '$id', '$schema'].includes(key) && !text(child).startsWith('#')) {
      deny('EXTERNAL_REFERENCE')
    }
    references(child)
  }
}
export function part(value: unknown, kinds: string): void {
  try {
    const p = record(value)
    object(
      p,
      p.type === 'output_text' ? 'type text annotations logprobs' : 'type text',
      'type text'
    )
    oneOf(p.type, kinds)
    text(p.text)
    for (const key of ['annotations', 'logprobs']) {
      if (Object.hasOwn(p, key) && array(p[key]).length) {
        deny('CONTENT_METADATA_UNSUPPORTED')
      }
    }
  } catch (error) {
    addTaskModelPolicyLocation(error, 'part')
    throw error
  }
}
