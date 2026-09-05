import { HiveAccountRelayPool } from '../../../../shared/hive-account-relay-pool'
import type { HiveAccountRelayMaterial } from '../../../../shared/hive-account-relay-material'
import type { HiveAccountRelaySocket } from '../../../../shared/hive-account-relay-channel'
import type { WebRuntimeClient } from '../web-runtime-client'
import { NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../../../shared/protocol-version'

export type WebAccountRuntimeClient = Pick<WebRuntimeClient, 'call' | 'subscribe' | 'close'>

export function createWebAccountRelayClient(
  createMaterial: () => Promise<HiveAccountRelayMaterial>,
  createSocket: (url: string) => HiveAccountRelaySocket = (url) =>
    new WebSocket(url) as unknown as HiveAccountRelaySocket
): WebAccountRuntimeClient {
  const pool = new HiveAccountRelayPool({
    createMaterial,
    createSocket,
    clientCapabilities: NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES
  })
  return {
    call: (method, params, options) => pool.request(method, params, options?.timeoutMs),
    subscribe: async (method, params, callbacks) => {
      const handle = await pool.subscribe(method, params, callbacks)
      return {
        unsubscribe: handle.close,
        sendBinary: (bytes) => {
          handle.sendBinary(new Uint8Array(bytes))
        }
      }
    },
    close: () => pool.close()
  }
}
