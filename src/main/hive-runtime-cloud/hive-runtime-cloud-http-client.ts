import { getMainHttpClient } from '../network/http-client'
import { parseHiveRelayJson } from '../../shared/hive-relay-json'
import { problemCategory } from './hive-runtime-cloud-response'

const REQUEST_TIMEOUT_MS = 10_000
const MAXIMUM_RESPONSE_BYTES = 65_536
const MAXIMUM_RETRY_AFTER_MS = 2_147_483_647

export type HiveRuntimeCloudFetch = (input: string, init: RequestInit) => Promise<Response>

const hostFetch: HiveRuntimeCloudFetch = (input, init) => getMainHttpClient().fetch(input, init)

export class HiveRuntimeCloudRequestError extends Error {
  constructor(
    readonly status: number,
    readonly category: string | null,
    readonly retryAfterMs: number | null = null
  ) {
    super('hive_runtime_cloud_request_failed')
    this.name = 'HiveRuntimeCloudRequestError'
  }
}

export class HiveRuntimeCloudTransportError extends Error {
  constructor() {
    super('hive_runtime_cloud_transport_failed')
    this.name = 'HiveRuntimeCloudTransportError'
  }
}

async function parseResponse(
  response: Response,
  maximumResponseBytes = MAXIMUM_RESPONSE_BYTES
): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maximumResponseBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('hive_runtime_cloud_response_too_large')
  }
  if (!response.body) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const chunk = await reader.read().catch(() => {
        throw new HiveRuntimeCloudTransportError()
      })
      if (chunk.done) {
        break
      }
      byteLength += chunk.value.byteLength
      if (byteLength > maximumResponseBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('hive_runtime_cloud_response_too_large')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return parseHiveRelayJson(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      maximumResponseBytes
    )
  } catch {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
}

async function parseProblemCategory(response: Response): Promise<string | null> {
  try {
    return problemCategory(await parseResponse(response))
  } catch {
    return null
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (value === null) {
    return null
  }
  const normalized = value.trim()
  if (!normalized || normalized.startsWith('-')) {
    return null
  }
  let delayMs: number
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized)
    if (Number.isNaN(seconds)) {
      return null
    }
    delayMs = Number.isFinite(seconds) ? seconds * 1_000 : MAXIMUM_RETRY_AFTER_MS
  } else {
    if (/^[+\d.]/.test(normalized)) {
      return null
    }
    delayMs = Date.parse(normalized) - Date.now()
  }
  return Number.isFinite(delayMs) && delayMs >= 0 ? Math.min(MAXIMUM_RETRY_AFTER_MS, delayMs) : null
}

async function requestError(response: Response): Promise<HiveRuntimeCloudRequestError> {
  return new HiveRuntimeCloudRequestError(
    response.status,
    await parseProblemCategory(response),
    parseRetryAfterMs(response.headers.get('retry-after'))
  )
}

export class HiveRuntimeCloudHttpClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: HiveRuntimeCloudFetch = hostFetch
  ) {}

  protected async request(
    path: string,
    request: Record<string, unknown> | undefined,
    headers: Record<string, string>,
    expectedStatus: number | readonly number[],
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.write('POST', path, request, headers, expectedStatus, signal)
  }

  protected async patch(
    path: string,
    request: Record<string, unknown>,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.write(
      'PATCH',
      path,
      request,
      { authorization: `Bearer ${accessToken}` },
      200,
      signal
    )
  }

  private async write(
    method: 'POST' | 'PATCH',
    path: string,
    request: Record<string, unknown> | undefined,
    headers: Record<string, string>,
    expectedStatus: number | readonly number[],
    signal?: AbortSignal
  ): Promise<unknown> {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    if (signal?.aborted) {
      controller.abort()
    } else {
      signal?.addEventListener('abort', abort, { once: true })
    }
    const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS)
    try {
      let response: Response
      try {
        response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
          method,
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...headers
          },
          body: JSON.stringify(request)
        })
      } catch {
        throw new HiveRuntimeCloudTransportError()
      }
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => undefined)
        throw new HiveRuntimeCloudTransportError()
      }
      const acceptedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]
      if (!acceptedStatuses.includes(response.status)) {
        throw await requestError(response)
      }
      if (response.status === 204) {
        const contentLength = response.headers.get('content-length')
        if (response.body !== null || (contentLength !== null && contentLength !== '0')) {
          throw new Error('invalid_hive_runtime_cloud_response')
        }
        return undefined
      }
      const value = await parseResponse(response)
      if (controller.signal.aborted) {
        throw new HiveRuntimeCloudTransportError()
      }
      return value
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  protected async get(
    path: string,
    accessToken: string | null,
    signal?: AbortSignal,
    maximumResponseBytes = MAXIMUM_RESPONSE_BYTES
  ): Promise<{ value: unknown; nextCursor: string | null }> {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    if (signal?.aborted) {
      controller.abort()
    } else {
      signal?.addEventListener('abort', abort, { once: true })
    }
    const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS)
    try {
      let response: Response
      try {
        response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
          }
        })
      } catch {
        throw new HiveRuntimeCloudTransportError()
      }
      if (response.status !== 200) {
        throw await requestError(response)
      }
      const value = await parseResponse(response, maximumResponseBytes)
      const nextCursor = response.headers.get('x-hive-next-cursor')
      if (
        nextCursor !== null &&
        (!nextCursor || nextCursor.length > 256 || /\s|=/.test(nextCursor))
      ) {
        throw new Error('invalid_hive_runtime_cloud_response')
      }
      return { value, nextCursor }
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
}
