import type { RuntimeE2EEClientSession } from './runtime-e2ee-client-session'
import { APP_DISPLAY_NAME } from './brand'
import { parseRemoteRuntimeJsonText } from './remote-runtime-request-frames'

export type RemoteRuntimeHandshakeState = 'awaiting_ready' | 'awaiting_authenticated' | 'ready'

export type RemoteRuntimeAuthenticatedFrame =
  | { kind: 'authenticated' }
  | { kind: 'rejected'; unauthorized: boolean }
  | { kind: 'invalid' }

export function classifyRemoteRuntimeReadyFrame(
  frame: string,
  session: RuntimeE2EEClientSession
): 'ready' | 'invalid' | 'unexpected' {
  let ready: unknown
  try {
    ready = parseRemoteRuntimeJsonText(frame)
  } catch {
    return 'invalid'
  }
  return typeof ready === 'object' &&
    ready !== null &&
    (ready as { type?: unknown }).type === 'e2ee_ready' &&
    session.acceptReady(ready)
    ? 'ready'
    : 'unexpected'
}

export function parseRemoteRuntimeAuthenticatedFrame(
  plaintext: string,
  session: RuntimeE2EEClientSession
): RemoteRuntimeAuthenticatedFrame {
  let authenticated: unknown
  try {
    authenticated = parseRemoteRuntimeJsonText(plaintext)
  } catch {
    return { kind: 'invalid' }
  }
  if ((authenticated as { type?: unknown }).type === 'e2ee_authenticated') {
    return session.isAuthenticated(plaintext) ? { kind: 'authenticated' } : { kind: 'invalid' }
  }
  return {
    kind: 'rejected',
    unauthorized:
      typeof authenticated === 'object' &&
      authenticated !== null &&
      (authenticated as { error?: { code?: unknown } }).error?.code === 'unauthorized'
  }
}

export function formatRemoteRuntimeCloseMessage(code: number, reason: Buffer): string {
  const suffixParts: string[] = []
  if (code !== 1005 && code !== 1006) {
    suffixParts.push(String(code))
  }
  const reasonText = reason.toString().trim()
  if (reasonText) {
    suffixParts.push(reasonText)
  }
  return suffixParts.length > 0
    ? `Remote ${APP_DISPLAY_NAME} runtime closed the connection (${suffixParts.join(': ')}).`
    : `Remote ${APP_DISPLAY_NAME} runtime closed the connection.`
}

export function ignoreSettledRemoteRuntimeSocketError(): void {}
