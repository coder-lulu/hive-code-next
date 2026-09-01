import { AppState, Platform } from 'react-native'
import { connect, type RpcClient } from './rpc-client'
import { createStableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ConnectionLogSink, HostProfile } from './types'
import { directPathForEndpoint } from './mobile-direct-endpoint-probe'
import { startMobileEndpointLifecycle } from './mobile-endpoint-lifecycle'
import { connectAccountRuntimeRpcSession } from '../runtime-directory/account-runtime-rpc-session'
import { registerAccountRuntimeClient } from '../runtime-directory/account-runtime-client-registry'
import { AccountRuntimeConnectionLifecycle } from '../runtime-directory/account-runtime-connection-lifecycle'

export async function openHostLogicalClient(
  host: HostProfile,
  onLog: ConnectionLogSink
): Promise<RpcClient> {
  let logical: ReturnType<typeof createStableLogicalRpcClient>
  let endpointLifecycle: ReturnType<typeof startMobileEndpointLifecycle> | null = null
  let accountLifecycle: AccountRuntimeConnectionLifecycle | null = null
  let unregisterAccountClient: (() => void) | null = null

  if (host.accountRuntime) {
    const connection = await host.accountRuntime.createConnection()
    const expiresAt = Date.parse(connection.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('account Runtime connection intent expired before use')
    }
    logical = createStableLogicalRpcClient(
      connectAccountRuntimeRpcSession({ connection, onLog }),
      'relay'
    )
    accountLifecycle = new AccountRuntimeConnectionLifecycle(
      logical,
      host.accountRuntime,
      'account-only',
      onLog
    )
    unregisterAccountClient = registerAccountRuntimeClient({
      hostId: host.id,
      runtimeRecordId: host.accountRuntime.runtimeRecordId,
      resourceVersion: host.accountRuntime.resourceVersion,
      accessMode: 'account-only'
    })
  } else {
    // Why: the stable facade owns app-visible RPC/subscription state while the
    // direct socket remains a replaceable first physical generation.
    logical = createStableLogicalRpcClient(
      connect(host.endpoint, host.deviceToken, host.publicKeyB64, { onLog }),
      directPathForEndpoint(host, host.endpoint)
    )
    if (Platform.OS !== 'web') {
      endpointLifecycle = startMobileEndpointLifecycle(logical, host, onLog)
    }
    if (host.accountRuntimeFallback) {
      accountLifecycle = new AccountRuntimeConnectionLifecycle(
        logical,
        host.accountRuntimeFallback,
        'local-fallback',
        onLog
      )
      unregisterAccountClient = registerAccountRuntimeClient({
        hostId: host.id,
        runtimeRecordId: host.accountRuntimeFallback.runtimeRecordId,
        resourceVersion: host.accountRuntimeFallback.resourceVersion,
        accessMode: 'local-fallback'
      })
    }
  }

  accountLifecycle?.start()
  const foreground = Platform.OS === 'web' || AppState.currentState === 'active'
  endpointLifecycle?.setForeground(foreground)
  accountLifecycle?.setForeground(foreground)
  const appStateSubscription =
    Platform.OS === 'web'
      ? null
      : AppState.addEventListener('change', (state) => {
          const active = state === 'active'
          endpointLifecycle?.setForeground(active)
          accountLifecycle?.setForeground(active)
        })
  const closeLogical = logical.close
  logical.close = () => {
    appStateSubscription?.remove()
    endpointLifecycle?.stop()
    accountLifecycle?.stop()
    unregisterAccountClient?.()
    closeLogical()
  }
  const notifyLogicalForeground = logical.notifyForeground
  logical.notifyForeground = (reason = 'focus') => {
    // Why: a nudge while already foreground must not re-enter setForeground —
    // that path suspended healthy relays; the supervisor probes or replaces instead.
    endpointLifecycle?.nudge(reason)
    accountLifecycle?.nudge(reason)
    notifyLogicalForeground(reason)
  }
  return logical
}
