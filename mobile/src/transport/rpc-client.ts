import { DirectRpcClient } from './direct-rpc-client'
import type { RpcClient, ConnectOptions } from './rpc-client-contract'
import type { ConnectionState } from './types'
export type { RpcClient, ConnectOptions, SendRequestOptions } from './rpc-client-contract'

export function connect(
  endpoint: string,
  deviceToken: string,
  serverPublicKeyB64: string,
  optionsOrLegacy?: ConnectOptions | ((state: ConnectionState) => void)
): RpcClient {
  const options: ConnectOptions =
    typeof optionsOrLegacy === 'function'
      ? { onStateChange: optionsOrLegacy }
      : (optionsOrLegacy ?? {})
  return new DirectRpcClient(endpoint, deviceToken, serverPublicKeyB64, options)
}
