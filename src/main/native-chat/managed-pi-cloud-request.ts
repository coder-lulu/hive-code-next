import { parseManagedPiTextRequest } from '../../shared/managed-pi-process-protocol'
import { parseHiveAiTextRequest, type HiveAiTextRequest } from '../../shared/hive-ai-text-request'

export type ManagedPiCloudRequest = Readonly<
  Omit<HiveAiTextRequest, 'messages'> & {
    messages: readonly Readonly<HiveAiTextRequest['messages'][number]>[]
  }
>

/** One text generation owns one Cloud request identity across process restarts. */
export function createManagedPiCloudRequest(value: unknown): ManagedPiCloudRequest {
  const input = parseManagedPiTextRequest(value)
  const request = parseHiveAiTextRequest({
    requestId: input.generationId.slice('ha-generation:'.length),
    sessionId: input.sessionId,
    generationId: input.generationId,
    ...input.modelSelection,
    messages: [...input.history, { role: 'user', text: input.text }]
  })
  return Object.freeze({
    ...request,
    messages: Object.freeze(request.messages.map((message) => Object.freeze(message)))
  })
}
