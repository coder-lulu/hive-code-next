import { connect, type RpcClient } from './rpc-client'
import { createStableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ConnectionLogSink, HostProfile } from './types'
import { directPathForEndpoint } from './mobile-direct-endpoint-probe'

export async function openHostLogicalClient(
  host: HostProfile,
  onLog: ConnectionLogSink
): Promise<RpcClient> {
  if (host.accountRuntime) {
    throw new Error('Account remote connection is not ready.')
  }
  return createStableLogicalRpcClient(
    connect(host.endpoint, host.deviceToken, host.publicKeyB64, { onLog }),
    directPathForEndpoint(host, host.endpoint)
  )
}
