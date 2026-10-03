import { parseHiveAgentTextContext, type HiveAgentContextMessage } from './hive-agent-text-context'
import type { HiveAiModelSelection } from './hive-ai-model-catalog'
import type { HiveAgentTextExecutionBinding } from './hive-agent-text-pack'

export type ManagedPiTextRequest = {
  sessionId: string
  generationId: string
  text: string
  history: readonly HiveAgentContextMessage[]
  modelSelection: Readonly<HiveAiModelSelection>
  executionBinding: Readonly<HiveAgentTextExecutionBinding>
}
export type ManagedPiInferenceEvent =
  | { type: 'text'; text: string }
  | { type: 'completed'; text: string }

const maxTextBytes = 1024 * 1024
const encoder = new TextEncoder()
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const digest = /^[a-f0-9]{64}$/
export function managedPiObject(
  value: unknown,
  fields: readonly string[]
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== fields.length ||
    !fields.every((field) => Object.hasOwn(value, field)) ||
    encoder.encode(JSON.stringify(value)).byteLength > 8 * 1024 * 1024
  ) {
    throw new Error('hive_agent_outcome_unknown')
  }
  return value as Record<string, unknown>
}
export function managedPiText(value: unknown, empty = false): string {
  if (
    typeof value !== 'string' ||
    !value.isWellFormed() ||
    (!empty && !value.length) ||
    encoder.encode(value).byteLength > maxTextBytes
  ) {
    throw new Error('hive_agent_outcome_unknown')
  }
  return value
}
export function managedPiSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1000) {
    throw new Error('hive_agent_outcome_unknown')
  }
  return value as number
}
export function managedPiScope(
  frame: Record<string, unknown>,
  epoch: string,
  sessionId: string,
  generationId?: string
): void {
  if (
    frame.epoch !== epoch ||
    frame.sessionId !== sessionId ||
    (generationId !== undefined && frame.generationId !== generationId)
  ) {
    throw new Error('hive_agent_outcome_unknown')
  }
}
/** Private IPC validation; no credentials, endpoints, authorization or durable state. */
export function parseManagedPiTextRequest(value: unknown): Readonly<ManagedPiTextRequest> {
  const request = managedPiObject(value, [
    'sessionId',
    'generationId',
    'text',
    'history',
    'modelSelection',
    'executionBinding'
  ])
  const model = managedPiObject(request.modelSelection, ['modelId', 'protocol', 'snapshotRevision'])
  const binding = managedPiObject(request.executionBinding, [
    'schemaVersion',
    'packRevision',
    'profileId',
    'protocol',
    'toolPolicy',
    'maxInputTokens',
    'maxOutputTokens'
  ])
  const text = managedPiText(request.text)
  if (
    typeof request.sessionId !== 'string' ||
    !new RegExp(`^ha-session:${uuid}$`).test(request.sessionId) ||
    typeof request.generationId !== 'string' ||
    !new RegExp(`^ha-generation:${uuid}$`).test(request.generationId) ||
    encoder.encode(text).byteLength > 12000 ||
    !text.trim() ||
    Array.from(text).some((char) => {
      const point = char.codePointAt(0)!
      return point === 127 || (point < 32 && char !== '\n' && char !== '\r' && char !== '\t')
    }) ||
    typeof model.modelId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model.modelId) ||
    !['CHAT_COMPLETIONS', 'RESPONSES'].includes(model.protocol as string) ||
    typeof model.snapshotRevision !== 'string' ||
    !digest.test(model.snapshotRevision) ||
    binding.schemaVersion !== 1 ||
    typeof binding.packRevision !== 'string' ||
    !digest.test(binding.packRevision) ||
    binding.profileId !== 'personal' ||
    binding.protocol !== model.protocol ||
    binding.toolPolicy !== 'empty' ||
    !Number.isSafeInteger(binding.maxInputTokens) ||
    (binding.maxInputTokens as number) < 1 ||
    (binding.maxInputTokens as number) > 16000 ||
    !Number.isSafeInteger(binding.maxOutputTokens) ||
    (binding.maxOutputTokens as number) < 1 ||
    (binding.maxOutputTokens as number) > 2000
  ) {
    throw new Error('hive_agent_invalid_request')
  }
  return Object.freeze({
    ...request,
    history: parseHiveAgentTextContext(request.history, text),
    modelSelection: Object.freeze({ ...model }),
    executionBinding: Object.freeze({ ...binding })
  }) as Readonly<ManagedPiTextRequest>
}
export function parseManagedPiInferenceEvent(value: unknown): ManagedPiInferenceEvent {
  const event = managedPiObject(value, ['type', 'text'])
  if (event.type !== 'text' && event.type !== 'completed') {
    throw new Error('hive_agent_outcome_unknown')
  }
  return Object.freeze({
    type: event.type,
    text: managedPiText(event.text, event.type === 'completed')
  })
}
