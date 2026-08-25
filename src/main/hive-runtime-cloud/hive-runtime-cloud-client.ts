import { net } from 'electron'
import {
  normalizeClaim,
  normalizeConnectionTicketConsume,
  normalizeHeartbeat,
  normalizeLease,
  normalizeLookup,
  normalizeRegistration,
  problemCategory,
  type RuntimeClaim,
  type RuntimeConnectionTicketConsume,
  type RuntimeHeartbeat,
  type RuntimeLease,
  type RuntimeRegistration,
  type RuntimeRegistrationLookup
} from './hive-runtime-cloud-response'

export type {
  RuntimeClaim,
  RuntimeConnectionTicketConsume,
  RuntimeHeartbeat,
  RuntimeLease,
  RuntimeRegistration,
  RuntimeRegistrationLookup
} from './hive-runtime-cloud-response'

const REQUEST_TIMEOUT_MS = 10_000
const MAXIMUM_RESPONSE_BYTES = 65_536

type FetchLike = (input: string, init: RequestInit) => Promise<Response>
const electronFetch: FetchLike = (input, init) => net.fetch(input, init)

export class HiveRuntimeCloudRequestError extends Error {
  constructor(
    readonly status: number,
    readonly category: string | null
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

async function parseResponse(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAXIMUM_RESPONSE_BYTES) {
    throw new Error('hive_runtime_cloud_response_too_large')
  }
  if (!response.body) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) {
      break
    }
    byteLength += chunk.value.byteLength
    if (byteLength > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('hive_runtime_cloud_response_too_large')
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
}

export class HiveRuntimeCloudClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: FetchLike = electronFetch
  ) {}

  private async request(
    path: string,
    request: Record<string, unknown>,
    headers: Record<string, string>,
    expectedStatus: number,
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
          method: 'POST',
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
      const value = await parseResponse(response)
      if (response.status !== expectedStatus) {
        throw new HiveRuntimeCloudRequestError(response.status, problemCategory(value))
      }
      return value
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  async lookup(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeRegistrationLookup> {
    return normalizeLookup(
      await this.request('/hive/v1/runtime-registrations/lookup', request, {}, 200, signal)
    )
  }

  async register(
    request: Record<string, unknown>,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<RuntimeRegistration> {
    return normalizeRegistration(
      await this.request(
        '/hive/v1/runtime-registrations',
        request,
        { 'idempotency-key': idempotencyKey },
        201,
        signal
      )
    )
  }

  async claim(
    request: Record<string, unknown>,
    accessToken: string,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<RuntimeClaim> {
    return normalizeClaim(
      await this.request(
        '/hive/v1/runtime-claims',
        request,
        { authorization: `Bearer ${accessToken}`, 'idempotency-key': idempotencyKey },
        200,
        signal
      )
    )
  }

  async acquireLease(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeLease> {
    return normalizeLease(
      await this.request('/hive/v1/runtime-leases/acquire', request, {}, 201, signal)
    )
  }

  async heartbeat(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeHeartbeat> {
    return normalizeHeartbeat(
      await this.request('/hive/v1/runtime-heartbeats', request, {}, 200, signal)
    )
  }

  async consumeConnectionTicket(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeConnectionTicketConsume> {
    return normalizeConnectionTicketConsume(
      await this.request('/hive/v1/connection-tickets', request, {}, 200, signal)
    )
  }
}
