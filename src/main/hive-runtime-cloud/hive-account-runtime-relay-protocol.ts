import WebSocket from 'ws'
import { MOBILE_E2EE_V2_FRAME_OVERHEAD_BYTES } from '../../shared/mobile-e2ee-v2-framing'
import {
  REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES,
  REMOTE_RUNTIME_MAX_WEBSOCKET_FRAME_BYTES
} from '../../shared/remote-runtime-memory-limits'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import {
  parseRemoteRuntimeJsonText,
  parseRemoteRuntimeRpcFrame
} from '../../shared/remote-runtime-request-frames'
import type { MobileE2EEOutboundMemoryBudget } from '../runtime/rpc/mobile-e2ee-outbound-memory-budget'

export type RelaySocket = Pick<
  WebSocket,
  'readyState' | 'bufferedAmount' | 'send' | 'close' | 'terminate' | 'on' | 'once' | 'off'
>

export type RelayConnectionDependencies = Readonly<{
  createSocket: (url: string) => RelaySocket
  now: () => number
  outboundMemoryBudget?: MobileE2EEOutboundMemoryBudget
}>

export const defaultRelayConnectionDependencies: RelayConnectionDependencies = {
  createSocket: (url) =>
    new WebSocket(url, {
      perMessageDeflate: false,
      maxPayload: Math.max(
        REMOTE_RUNTIME_MAX_WEBSOCKET_FRAME_BYTES,
        REMOTE_RUNTIME_MAX_OUTBOUND_BINARY_FRAME_BYTES + MOBILE_E2EE_V2_FRAME_OVERHEAD_BYTES
      )
    }),
  now: Date.now
}

export function relaySocketUrl(relay: { cellUrl: string; relayHostId: string }): string {
  const url = new URL(relay.cellUrl)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('Cloud Runtime relay must use HTTPS')
  }
  url.protocol = 'wss:'
  url.pathname = `/v1/connect/${encodeURIComponent(relay.relayHostId)}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function parseRelayTicketHello(
  raw: string,
  now: number
): { credentialKind: 'ticket'; leaseExpiresAt: number } | null {
  let value: unknown
  try {
    value = parseRemoteRuntimeJsonText(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const hello = value as Record<string, unknown>
  if (
    Object.keys(hello).sort().join(',') !== 'credentialKind,leaseExpiresAt,ok,type' ||
    hello.type !== 'relay-hello' ||
    hello.ok !== true ||
    hello.credentialKind !== 'ticket' ||
    typeof hello.leaseExpiresAt !== 'number' ||
    !Number.isSafeInteger(hello.leaseExpiresAt) ||
    hello.leaseExpiresAt <= now
  ) {
    return null
  }
  return { credentialKind: 'ticket', leaseExpiresAt: hello.leaseExpiresAt }
}

export function parseRuntimeResponse(plaintext: string): RuntimeRpcResponse<unknown> | null {
  const parsed = parseRemoteRuntimeRpcFrame(plaintext)
  if (parsed.type === 'keepalive') {
    return null
  }
  if (parsed.type === 'error') {
    throw parsed.error
  }
  return parsed.response
}

export function relayRawDataBytes(raw: WebSocket.RawData): Uint8Array {
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw)
  }
  if (Array.isArray(raw)) {
    return new Uint8Array(Buffer.concat(raw))
  }
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
}

export function asRelayError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function relayConnectionError(message: string): RemoteRuntimeClientError {
  return new RemoteRuntimeClientError('remote_runtime_unavailable', message)
}

export function relayProtocolError(detail: string): RemoteRuntimeClientError {
  return new RemoteRuntimeClientError(
    'invalid_runtime_response',
    `Cloud Runtime relay returned an invalid encrypted response (${detail}).`
  )
}
