import type { RuntimeRpcResponse, RuntimeRpcSuccess } from '../../../shared/runtime-rpc-envelope'
import type { WebPairingOffer } from './web-pairing'
import type { CloudLaunchBootstrap } from './cloud-launch-bootstrap'

export type WebRuntimeConnection =
  | {
      kind: 'pairing'
      endpoint: string
      publicKeyB64: string
      deviceToken: string
    }
  | {
      kind: 'cloud-managed'
      endpoint: string
      publicKeyB64: string
      managedWebSessionId: string
      runtimeSessionId: string
      sessionToken: string
      expiresAt: string
    }

export function normalizeConnection(
  input: WebPairingOffer | CloudLaunchBootstrap | WebRuntimeConnection
): WebRuntimeConnection {
  if ('kind' in input) {
    return input
  }
  if ('protocolVersion' in input) {
    return {
      kind: 'cloud-managed',
      endpoint: input.websocketUrl,
      publicKeyB64: input.serverPublicKeyB64,
      managedWebSessionId: input.managedWebSessionId,
      runtimeSessionId: input.runtimeSessionId,
      sessionToken: input.sessionToken,
      expiresAt: input.expiresAt
    }
  }
  return {
    kind: 'pairing',
    endpoint: input.endpoint,
    publicKeyB64: input.publicKeyB64,
    deviceToken: input.deviceToken
  }
}

export function isRuntimeFailureResponse(
  response: unknown
): response is RuntimeRpcResponse<unknown> & { ok: false } {
  return (
    typeof response === 'object' &&
    response !== null &&
    !Array.isArray(response) &&
    'ok' in response &&
    response.ok === false &&
    'error' in response &&
    !!response.error &&
    typeof response.error === 'object' &&
    'code' in response.error
  )
}

export function getFileWatchSubscriptionId(response: RuntimeRpcResponse<unknown>): string | null {
  if (!response.ok) {
    return null
  }
  const result = response.result
  if (!result || typeof result !== 'object') {
    return null
  }
  const subscriptionId = (result as { subscriptionId?: unknown }).subscriptionId
  return typeof subscriptionId === 'string' ? subscriptionId : null
}

export function createFileWatchReplayOverflowResponse(
  readyResponse: RuntimeRpcSuccess<unknown>,
  params: unknown
): RuntimeRpcSuccess<{
  type: 'changed'
  worktree: string
  events: { kind: 'overflow'; absolutePath: string }[]
}> {
  const worktree = (params as { worktree?: unknown } | null)?.worktree
  return {
    id: readyResponse.id,
    ok: true,
    result: {
      type: 'changed',
      worktree: typeof worktree === 'string' ? worktree : '',
      // Why: overflow consumers re-scan the whole root and ignore the path (client lacks the server-side root here).
      events: [{ kind: 'overflow', absolutePath: '' }]
    },
    _meta: readyResponse._meta
  }
}

export function isFileWatchStartingResponse(
  response: RuntimeRpcResponse<unknown>
): response is RuntimeRpcSuccess<{ type: 'starting'; subscriptionId: string }> {
  return (
    response.ok &&
    !!response.result &&
    typeof response.result === 'object' &&
    (response.result as { type?: unknown; subscriptionId?: unknown }).type === 'starting' &&
    typeof (response.result as { subscriptionId?: unknown }).subscriptionId === 'string'
  )
}

export function isEndResult(value: unknown): value is { type: 'end' } {
  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'end'
}

export async function websocketPayloadToUint8(
  value: unknown
): Promise<Uint8Array<ArrayBufferLike> | null> {
  if (value instanceof Uint8Array) {
    return value
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer())
  }
  return null
}
