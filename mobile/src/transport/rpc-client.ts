import { DirectRpcClient } from './direct-rpc-client'
import type { ConnectOptions, RpcClient } from './rpc-client-contract'
import type { ConnectionState } from './types'

export type { ConnectOptions, RpcClient, SendRequestOptions } from './rpc-client-contract'

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
