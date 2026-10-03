import type { RuntimeOrchestrationEnvelope, RuntimeRpcResponse } from './runtime-rpc-envelope'
import { parseHiveRelayJson } from './hive-relay-json'
import { measureUtf8ByteLength } from './utf8-byte-limits'

export type HiveAccountRelaySocket = {
  readonly readyState: number
  readonly bufferedAmount: number
  binaryType: string
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code?: number }) => void) | null
  onerror: (() => void) | null
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
}

export type HiveAccountRelayRequest = RuntimeOrchestrationEnvelope & {
  id: string
  method: string
  params?: unknown
}

export type HiveAccountRelaySubscription = {
  onResponse: (response: RuntimeRpcResponse<unknown>) => void
  onBinary?: (bytes: Uint8Array) => void
  onClose?: () => void
}

export function validateRelayHello(
  raw: string,
  binding: {
    cellId: string
    cellIncarnationId: string
  }
): boolean {
  const value = parseHiveRelayJson(raw) as Record<string, unknown> | null
  return (
    !!value &&
    Object.keys(value).length === 5 &&
    value.type === 'relay-hello' &&
    value.v === 2 &&
    typeof value.connId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.connId) &&
    value.cellId === binding.cellId &&
    value.cellIncarnationId === binding.cellIncarnationId
  )
}

export function relayPayloadBytes(value: unknown): number {
  if (typeof value === 'string') {
    return measureUtf8ByteLength(value, { stopAfterBytes: 8 * 1024 * 1024 + 82 }).byteLength
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value.byteLength
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return value.size
  }
  throw new Error('Invalid relay frame')
}

export async function relayBinary(value: unknown): Promise<Uint8Array> {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer())
  }
  throw new Error('Invalid relay binary frame')
}

export function assertRelayRequest(
  request: HiveAccountRelayRequest,
  ready: boolean,
  duplicate: boolean
): void {
  if (!ready) {
    throw new Error('Relay channel is unavailable')
  }
  if (!request.id || !request.method || duplicate) {
    throw new Error('Invalid relay request')
  }
  if (
    [
      'deviceToken',
      'sessionToken',
      'authToken',
      'ticketSecret',
      'principalKind',
      'ticketId',
      'clientAdmissionToken'
    ].some((key) => Object.hasOwn(request, key))
  ) {
    throw new Error('Authentication is bound to the connection')
  }
}
