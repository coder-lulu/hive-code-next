import { RuntimeE2EEClientSession } from './runtime-e2ee-client-session'
import WebSocket from 'ws'
import { APP_DISPLAY_NAME } from './brand'
import type { PairingOffer } from './pairing'
import { RemoteRuntimeClientError } from './remote-runtime-client'
import {
  remoteRuntimeConnectFailureMessage,
  remoteRuntimeConnectOptions
} from './remote-runtime-connect-bound'
import {
  invalidRemoteRuntimeResponseError,
  remoteRuntimeUnavailableError
} from './remote-runtime-request-frames'

export type RemoteRuntimeWebSocket = {
  ws: WebSocket
  session: RuntimeE2EEClientSession
  cleanup: () => void
}

export type RemoteRuntimeWebSocketCallbacks = {
  onClose: (ws: WebSocket, code: number, reason: Buffer) => void
  onError: (ws: WebSocket, error: RemoteRuntimeClientError) => void
  onTextFrame: (ws: WebSocket, frame: string) => void
  // Why: protocol-level pongs (and server heartbeat pings) are the liveness
  // signal for detecting half-open tunnels that never deliver `close` (#7718).
  onPong?: (ws: WebSocket) => void
  onPing?: (ws: WebSocket) => void
}

export function openRemoteRuntimeWebSocket(
  pairing: PairingOffer,
  callbacks: RemoteRuntimeWebSocketCallbacks,
  // Why: overridable so the connect-bound regression test can pin the behaviour
  // without spending the production budget of wall-clock time.
  connectTimeoutMs?: number
): { ok: true; socket: RemoteRuntimeWebSocket } | { ok: false; error: RemoteRuntimeClientError } {
  const opened = createSocket(pairing, connectTimeoutMs)
  if (!opened.ok) {
    return opened
  }
  const { ws, session } = opened

  let cleanedUp = false
  const onOpen = (): void => {
    ws.send(JSON.stringify(session.hello))
  }
  const onError = (error: Error): void => {
    callbacks.onError(
      ws,
      remoteRuntimeUnavailableError(remoteRuntimeConnectFailureMessage(error, pairing.endpoint))
    )
  }
  const onClose = (code: number, reason: Buffer): void => callbacks.onClose(ws, code, reason)
  const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
    if (isBinary) {
      callbacks.onError(
        ws,
        invalidRemoteRuntimeResponseError(
          `Remote ${APP_DISPLAY_NAME} runtime returned an unexpected binary frame.`
        )
      )
      return
    }
    callbacks.onTextFrame(ws, data.toString())
  }
  const onPong = (): void => callbacks.onPong?.(ws)
  const onPing = (): void => callbacks.onPing?.(ws)
  const cleanup = (): void => {
    if (cleanedUp) {
      return
    }
    cleanedUp = true
    ws.off('open', onOpen)
    ws.off('error', onError)
    ws.off('close', onClose)
    ws.off('message', onMessage)
    ws.off('pong', onPong)
    ws.off('ping', onPing)
    // Why: a manually closed ws can still emit a late transport error; keep
    // that from becoming an unhandled EventEmitter error after detaching Orca.
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.on('error', ignoreLateSocketError)
    }
  }

  ws.once('open', onOpen)
  ws.on('error', onError)
  ws.on('close', onClose)
  ws.on('message', onMessage)
  ws.on('pong', onPong)
  ws.on('ping', onPing)
  return { ok: true, socket: { ws, session, cleanup } }
}

function ignoreLateSocketError(): void {}

function createSocket(
  pairing: PairingOffer,
  connectTimeoutMs?: number
):
  | { ok: true; ws: WebSocket; session: RuntimeE2EEClientSession }
  | { ok: false; error: RemoteRuntimeClientError } {
  let session: RuntimeE2EEClientSession
  try {
    session = RuntimeE2EEClientSession.create({
      desktopPublicKeyB64: pairing.publicKeyB64,
      transport: 'direct'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: new RemoteRuntimeClientError(
        'invalid_argument',
        `Invalid remote pairing key: ${message}`
      )
    }
  }
  try {
    return {
      ok: true,
      ws: new WebSocket(pairing.endpoint, remoteRuntimeConnectOptions(undefined, connectTimeoutMs)),
      session
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: new RemoteRuntimeClientError('invalid_argument', `Invalid remote endpoint: ${message}`)
    }
  }
}
