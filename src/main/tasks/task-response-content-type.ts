const kinds = [
  'missing',
  'empty',
  'over_limit',
  'sse_parameters',
  'json',
  'html',
  'text',
  'other',
  'malformed'
] as const
export type TaskResponseContentTypeKind = (typeof kinds)[number]

export function isTaskResponseContentTypeKind(
  value: unknown
): value is TaskResponseContentTypeKind {
  return typeof value === 'string' && kinds.some((kind) => kind === value)
}

/** Refused header metadata only; neither parameters nor the unread body are identified. */
export function classifyRefusedTaskContentType(value: string | null): TaskResponseContentTypeKind {
  if (value === null) {
    return 'missing'
  }
  if (value.length > 128) {
    return 'over_limit'
  }
  const normalized = value.replace(/^[ \t]+|[ \t]+$/g, '')
  if (!normalized) {
    return 'empty'
  }
  const separator = normalized.indexOf(';')
  const essence = (separator === -1 ? normalized : normalized.slice(0, separator))
    .replace(/[ \t]+$/g, '')
    .toLowerCase()
  if (!/^[!#$%&'*+\-.^_`|~a-z0-9]+\/[!#$%&'*+\-.^_`|~a-z0-9]+$/.test(essence)) {
    return 'malformed'
  }
  if (essence === 'text/event-stream') {
    return separator === -1 ? 'malformed' : 'sse_parameters'
  }
  if (essence === 'application/json') {
    return 'json'
  }
  if (essence === 'text/html') {
    return 'html'
  }
  return essence.startsWith('text/') ? 'text' : 'other'
}
