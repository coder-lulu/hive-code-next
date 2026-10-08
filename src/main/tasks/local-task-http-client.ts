import { readFetchResponseBytesWithinLimit } from '../../shared/fetch-response-body'
import { assertJsonTextStructureWithinLimits } from '../../shared/json-text-structure-limit'
import { isRecord } from '../../shared/agent-status-child-work-value-guards'
import { TASK_EXECUTION_ERROR_CODES, TaskExecutionError } from './task-execution-error'

export type LocalTaskClientOptions = {
  baseUrl: string
  secret: string
  fetch?: typeof fetch
  requestTimeoutMs?: number
  requestTimeoutMsByPath?: Readonly<Record<string, number>>
  headers?: Readonly<Record<string, string>>
  maximumResponseBytes?: number
  maximumResponseBytesByPath?: Readonly<Record<string, number>>
  maximumResponseStructuralTokensByPath?: Readonly<Record<string, number>>
}
const MAX_BYTES = 64 * 1024

/** The credential's only audience is the exact local task service; redirects are never followed. */
export function createLocalTaskRequest(options: LocalTaskClientOptions) {
  let base: URL
  try {
    base = new URL(options.baseUrl)
  } catch {
    throw new TaskExecutionError('INVALID_REQUEST')
  }
  if (
    base.protocol !== 'http:' ||
    base.hostname !== '127.0.0.1' ||
    !base.port ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    !/^[A-Za-z0-9_-]{43}$/.test(options.secret)
  ) {
    throw new TaskExecutionError('INVALID_REQUEST')
  }
  const fetchImpl = options.fetch ?? fetch
  return async (path: string, body?: unknown): Promise<unknown> => {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    const target = new URL(path, base)
    if (target.origin !== base.origin || target.username || target.password) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    try {
      const response = await fetchImpl(target, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: {
          ...options.headers,
          Authorization: `Bearer ${options.secret}`,
          'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(
          options.requestTimeoutMs ?? options.requestTimeoutMsByPath?.[target.pathname] ?? 10_000
        )
      })
      const bytes = await readFetchResponseBytesWithinLimit(
        response,
        options.maximumResponseBytesByPath?.[target.pathname] ??
          options.maximumResponseBytes ??
          MAX_BYTES
      )
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      assertJsonTextStructureWithinLimits(content, {
        nestingDepth: 16,
        structuralTokens: options.maximumResponseStructuralTokensByPath?.[target.pathname] ?? 16_384
      })
      const value: unknown = JSON.parse(content)
      if (!response.ok) {
        const error = isRecord(value) && isRecord(value.error) ? value.error.code : null
        const code = TASK_EXECUTION_ERROR_CODES.find((entry) => entry === error)
        throw new TaskExecutionError(code ?? 'SERVICE_UNAVAILABLE')
      }
      return value
    } catch (error) {
      if (error instanceof TaskExecutionError) {
        throw error
      }
      throw new TaskExecutionError('SERVICE_UNAVAILABLE')
    }
  }
}
