import type { RuntimeE2EEClientSession } from '../../../shared/runtime-e2ee-client-session'

export type WebRuntimeClientTransport = {
  connectionWaiters: {
    wait: (timeoutMs?: number) => Promise<void>
  }
  sendEncrypted: (message: unknown) => boolean
  sendEncryptedBinary: (bytes: Uint8Array<ArrayBufferLike>) => boolean
}

export function createWebRuntimeClientTransport(deps: {
  waitForConnected: (timeoutMs?: number) => Promise<void>
  getWebSocket: () => WebSocket | null
  getSession: () => RuntimeE2EEClientSession | null
}): WebRuntimeClientTransport {
  const sendEncrypted = (message: unknown): boolean => {
    const ws = deps.getWebSocket()
    const session = deps.getSession()
    if (!ws || ws.readyState !== WebSocket.OPEN || !session) {
      return false
    }
    ws.send(session.sealText(JSON.stringify(message)))
    return true
  }
  const sendEncryptedBinary = (bytes: Uint8Array<ArrayBufferLike>): boolean => {
    const ws = deps.getWebSocket()
    const session = deps.getSession()
    if (!ws || ws.readyState !== WebSocket.OPEN || !session) {
      return false
    }
    ws.send(new Uint8Array(session.sealBinary(bytes)))
    return true
  }
  return {
    connectionWaiters: {
      wait: (timeoutMs) => deps.waitForConnected(timeoutMs)
    },
    sendEncrypted,
    sendEncryptedBinary
  }
}
