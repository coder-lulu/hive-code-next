import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { isKeepaliveFrame } from '../../../shared/runtime-rpc-envelope'
import { createWebRuntimeUnauthorizedError } from './web-runtime-client-error'
import type { RuntimeE2EEClientSession } from '../../../shared/runtime-e2ee-client-session'
import type { WebRuntimeTransportSubscription } from './web-runtime-subscription-contract'

export type WebRuntimeConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'auth-failed'

export type WebRuntimePendingRequest = {
  method: string
  resolve: (response: RuntimeRpcResponse<unknown>) => void
  reject: (error: Error) => void
  timeout: number
}

type WebRuntimeConnectionFrameContext = {
  getState: () => WebRuntimeConnectionState
  getSession: () => RuntimeE2EEClientSession | null
  getSocket: () => WebSocket | null
  authenticationFrame: () => Record<string, unknown>
  pending: Map<string, WebRuntimePendingRequest>
  subscriptions: Map<string, WebRuntimeTransportSubscription>
  sendEncrypted: (message: unknown) => boolean
  setConnected: () => void
  setAuthFailed: () => void
  rejectUnauthorized: (error: Error) => void
  notifyUnauthorized: () => void
}

export async function routeWebRuntimeConnectionFrame(
  rawData: unknown,
  sourceWs: WebSocket | undefined,
  context: WebRuntimeConnectionFrameContext
): Promise<void> {
  const raw = typeof rawData === 'string' ? rawData : null
  const session = context.getSession()
  if (context.getState() === 'handshaking') {
    if (raw === null || !session) {
      return
    }
    try {
      const control = JSON.parse(raw) as { type?: unknown }
      if (control.type === 'e2ee_ready') {
        if (!session.acceptReady(control)) {
          context.getSocket()?.close()
          return
        }
        context.sendEncrypted(context.authenticationFrame())
        return
      }
    } catch {
      // The authenticated control frame is encrypted, so non-JSON is normal here.
    }
    const plaintext = session.openText(raw)
    if (plaintext === null) {
      return
    }
    try {
      const control = JSON.parse(plaintext) as {
        type?: unknown
        error?: { code?: string; message?: string }
      }
      if (session.isAuthenticated(plaintext)) {
        context.setConnected()
      } else if (control.type === 'e2ee_error' || control.error?.code === 'unauthorized') {
        const error = createWebRuntimeUnauthorizedError()
        context.setAuthFailed()
        context.rejectUnauthorized(error)
        context.notifyUnauthorized()
        context.getSocket()?.close()
      }
    } catch {
      // Ignore malformed handshake payloads; the server will close on timeout.
    }
    return
  }

  if (context.getState() !== 'connected' || !session) {
    return
  }
  if (raw === null) {
    const encrypted = await websocketPayloadToUint8(rawData)
    if (sourceWs && context.getSocket() !== sourceWs) {
      return
    }
    if (!encrypted) {
      return
    }
    const plaintext = session.openBinary(encrypted)
    if (!plaintext) {
      return
    }
    for (const subscription of context.subscriptions.values()) {
      subscription.callbacks.onBinary?.(plaintext)
    }
    return
  }

  const plaintext = session.openText(raw)
  if (plaintext === null) {
    return
  }
  let response: RuntimeRpcResponse<unknown> | Record<string, unknown>
  try {
    response = JSON.parse(plaintext) as RuntimeRpcResponse<unknown> | Record<string, unknown>
  } catch {
    return
  }
  if (isKeepaliveFrame(response) || !('id' in response) || typeof response.id !== 'string') {
    return
  }
  if (isRuntimeFailureResponse(response) && response.error.code === 'unauthorized') {
    const error = createWebRuntimeUnauthorizedError()
    context.setAuthFailed()
    context.rejectUnauthorized(error)
    context.notifyUnauthorized()
    context.getSocket()?.close()
    return
  }

  const subscription = context.subscriptions.get(response.id)
  if (subscription) {
    const subscriptionResponse = response as RuntimeRpcResponse<unknown>
    if (subscriptionResponse.ok === false) {
      context.subscriptions.delete(response.id)
    }
    subscription.callbacks.onResponse(subscriptionResponse)
    if (subscriptionResponse.ok && isEndResult(subscriptionResponse.result)) {
      context.subscriptions.delete(response.id)
      subscription.callbacks.onClose?.()
    }
    return
  }
  const pending = context.pending.get(response.id)
  if (!pending) {
    return
  }
  context.pending.delete(response.id)
  window.clearTimeout(pending.timeout)
  pending.resolve(response as RuntimeRpcResponse<unknown>)
}

function isRuntimeFailureResponse(
  response: RuntimeRpcResponse<unknown> | Record<string, unknown>
): response is RuntimeRpcResponse<unknown> & { ok: false } {
  return (
    'ok' in response &&
    response.ok === false &&
    'error' in response &&
    !!response.error &&
    typeof response.error === 'object' &&
    'code' in response.error
  )
}

function isEndResult(value: unknown): value is { type: 'end' } {
  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'end'
}

async function websocketPayloadToUint8(
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
