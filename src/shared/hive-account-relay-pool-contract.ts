import type { HiveAccountRelayChannel, HiveAccountRelaySocket } from './hive-account-relay-channel'
import type { RemoteRuntimeClientError } from './remote-runtime-client-error'
import type { RuntimeRpcResponse } from './runtime-rpc-envelope'
import type { HiveAccountRelayMaterial } from './hive-account-relay-material'
import type { RuntimeCapability } from './protocol-version'

export type HiveAccountRelayPoolState = 'idle' | 'connecting' | 'ready' | 'closed'
export type HiveAccountRelayPoolOptions = {
  createMaterial: () => Promise<HiveAccountRelayMaterial>
  createSocket: (url: string) => HiveAccountRelaySocket
  clientCapabilities?: readonly RuntimeCapability[]
  randomBytes?: (length: number) => Uint8Array
  onStateChange?: (state: HiveAccountRelayPoolState) => void
  onStatusReceiptLost?: () => void
  onConnectionLost?: (error: Error) => void
}
export type HiveAccountRelayCallbacks = {
  onResponse: (response: RuntimeRpcResponse<unknown>) => void
  onBinary?: (bytes: Uint8Array) => void
  onClose?: () => void
  onError?: (error: RemoteRuntimeClientError) => void
}
export type HiveAccountRelayStream = {
  channel: Promise<HiveAccountRelayChannel>
  consumers: Set<HiveAccountRelayCallbacks>
}
export function publishHiveAccountRelayConsumers(
  listeners: Set<HiveAccountRelayCallbacks>,
  action: (listener: HiveAccountRelayCallbacks) => void
): void {
  for (const listener of Array.from(listeners)) {
    try {
      action(listener)
    } catch {
      /* Isolate consumer callbacks during release. */
    }
  }
}
