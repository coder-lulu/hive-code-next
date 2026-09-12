import { HiveAccountRelayPool } from '../../../../shared/hive-account-relay-pool'
import type { HiveAccountRelayMaterial } from '../../../../shared/hive-account-relay-material'
import type { HiveAccountRelaySocket } from '../../../../shared/hive-account-relay-channel'
import type { WebRuntimeClient, WebRuntimeStatusOptions } from '../web-runtime-client'
import { NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../../../shared/protocol-version'
import { RuntimeHostStatusOwner } from '../../../../shared/runtime-host-status-owner'
import type { RuntimeHostStatusResponse } from '../../../../shared/runtime-host-status'

export type WebAccountRuntimeClient = Pick<WebRuntimeClient, 'call' | 'subscribe' | 'close'> & {
  readonly statusOwner?: RuntimeHostStatusOwner
  configureStatusOwner?: (options: WebRuntimeStatusOptions) => void
}

export function createWebAccountRelayClient(
  createMaterial: () => Promise<HiveAccountRelayMaterial>,
  createSocket: (url: string) => HiveAccountRelaySocket = (url) =>
    new WebSocket(url) as unknown as HiveAccountRelaySocket
): WebAccountRuntimeClient {
  let statusOwner: RuntimeHostStatusOwner | undefined
  let statusOptions: WebRuntimeStatusOptions | undefined
  const publishConnection = (): void => {
    statusOwner?.connectionChanged(
      pool.getState() === 'ready'
        ? 'ready'
        : pool.getState() === 'connecting'
          ? 'connecting'
          : 'disconnected'
    )
    if (pool.getState() === 'ready') {
      statusOwner?.activate()
    }
  }
  const pool = new HiveAccountRelayPool({
    createMaterial,
    createSocket,
    clientCapabilities: NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES,
    onStateChange: publishConnection,
    onStatusReceiptLost: () => {
      statusOwner?.connectionChanged('connecting')
      publishConnection()
    }
  })
  return {
    get statusOwner() {
      return statusOwner
    },
    configureStatusOwner: (options) => {
      if (statusOptions) {
        if (
          options.environmentId !== statusOptions.environmentId ||
          options.pairingRevision !== statusOptions.pairingRevision
        ) {
          throw new Error('Account Relay status belongs to another runtime owner.')
        }
        return
      }
      statusOptions = options
      statusOwner = new RuntimeHostStatusOwner({
        ...options,
        persistent: true,
        request: (signal) => pool.requestStatus(signal) as Promise<RuntimeHostStatusResponse>,
        verified: (response) => {
          options.verified(response)
          return true
        }
      })
      publishConnection()
    },
    call: (method, params, options) =>
      method === 'status.get' && statusOwner
        ? statusOwner.refresh(options)
        : pool.request(method, params, options?.timeoutMs),
    subscribe: async (method, params, callbacks) => {
      const handle = await pool.subscribe(method, params, callbacks)
      return {
        unsubscribe: handle.close,
        sendBinary: (bytes) => {
          handle.sendBinary(new Uint8Array(bytes))
        }
      }
    },
    close: () => {
      statusOwner?.dispose()
      pool.close()
    }
  }
}
