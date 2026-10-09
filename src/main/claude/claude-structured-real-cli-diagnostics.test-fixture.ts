import type { ClaudeStructuredSessionEvent } from './claude-structured-session-adapter'

export function commandLifecycleIndex(
  events: ClaudeStructuredSessionEvent[],
  uuid: string | undefined,
  state: 'queued' | 'started'
): number {
  return events.findIndex(
    (event) =>
      typeof uuid === 'string' &&
      event.type === 'message' &&
      event.message.type === 'command_lifecycle' &&
      event.message.command_uuid === uuid &&
      event.message.state === state
  )
}

export function observedFailure(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : ''
  return {
    errorClass: error instanceof Error ? error.name : typeof error,
    httpStatuses: [...message.matchAll(/\b(?:401|403|408|429|5\d\d)\b/g)].map(([code]) => code),
    timeout: /timed? ?out|timeout/i.test(message)
  }
}

type ClaudeStreamDiagnostic = { type: string }

function parseClaudeStreamDiagnostic(value: unknown): ClaudeStreamDiagnostic | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return undefined
  }
  const type = value.type
  return typeof type === 'string' ? { type } : undefined
}

export function streamObjectType(
  value: unknown,
  key?: 'delta' | 'content_block'
): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const nested =
    key === undefined
      ? value
      : key === 'delta' && 'delta' in value
        ? value.delta
        : key === 'content_block' && 'content_block' in value
          ? value.content_block
          : undefined
  return parseClaudeStreamDiagnostic(nested)?.type
}
