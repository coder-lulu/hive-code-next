import { encrypt, encryptBytes } from './web-e2ee'

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
  getSharedKey: () => Uint8Array | null
}): WebRuntimeClientTransport {
  const sendEncrypted = (message: unknown): boolean => {
    const ws = deps.getWebSocket()
    const sharedKey = deps.getSharedKey()
    if (!ws || ws.readyState !== WebSocket.OPEN || !sharedKey) {
      return false
    }
    ws.send(encrypt(JSON.stringify(message), sharedKey))
    return true
  }
  const sendEncryptedBinary = (bytes: Uint8Array<ArrayBufferLike>): boolean => {
    const ws = deps.getWebSocket()
    const sharedKey = deps.getSharedKey()
    if (!ws || ws.readyState !== WebSocket.OPEN || !sharedKey) {
      return false
    }
    ws.send(encryptBytes(bytes, sharedKey))
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
