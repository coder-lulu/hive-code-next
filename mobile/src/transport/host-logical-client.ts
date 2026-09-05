import { connect, type RpcClient } from './rpc-client'
import { createStableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ConnectionLogSink, HostProfile } from './types'
import { directPathForEndpoint } from './mobile-direct-endpoint-probe'
import { AccountRuntimeRpcClient } from './account-runtime-rpc-client'

export async function openHostLogicalClient(
  host: HostProfile,
  onLog: ConnectionLogSink
): Promise<RpcClient> {
  if (host.accountRuntime) {
    return createStableLogicalRpcClient(
      new AccountRuntimeRpcClient(host.id, host.accountRuntime, onLog),
      'relay'
    )
  }
  return createStableLogicalRpcClient(
    connect(host.endpoint, host.deviceToken, host.publicKeyB64, { onLog }),
    directPathForEndpoint(host, host.endpoint)
  )
}
