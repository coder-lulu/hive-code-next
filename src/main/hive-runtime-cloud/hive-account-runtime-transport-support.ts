import type { HiveAccountRuntimeConnectionMaterial } from './hive-account-runtime-connection-material'
import { HiveAccountRuntimeRelayConnection } from './hive-account-runtime-relay-connection'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../shared/runtime-types'
import type { RuntimeEnvironmentAccountClaim } from '../../shared/runtime-environments'

export const HIVE_ACCOUNT_RUNTIME_DEFAULT_TIMEOUT_MS = 15_000

export type AccountRelayConnection = Pick<
  HiveAccountRuntimeRelayConnection,
  'connect' | 'request' | 'subscribe' | 'close'
>

export type AccountRuntimeTransportDependencies = Readonly<{
  createRelayConnection: (material: HiveAccountRuntimeConnectionMaterial) => AccountRelayConnection
  maxCachedRequestConnections?: number
}>

export const defaultAccountRuntimeTransportDependencies: AccountRuntimeTransportDependencies = {
  createRelayConnection: (material) => new HiveAccountRuntimeRelayConnection(material)
}

export type CachedAccountRuntimeConnection = {
  resourceVersion: number
  connection: AccountRelayConnection | null
  ready: Promise<AccountRelayConnection>
}

export type AccountRuntimeSubscriptionConnection = {
  runtimeRecordId: string
  resourceVersion: number
}

export function accountRuntimeStatusFailure(
  claim: RuntimeEnvironmentAccountClaim,
  error: unknown
): RuntimeRpcResponse<RuntimeStatus> {
  return {
    id: 'status.get',
    ok: false,
    error: {
      code: error instanceof RemoteRuntimeClientError ? error.code : 'runtime_unavailable',
      message: error instanceof Error ? error.message : 'Cloud Runtime is unavailable.'
    },
    _meta: { runtimeId: claim.runtimeRecordId }
  }
}
