import type { HiveAccountRuntimeDirectoryState } from '../../shared/hive-runtime-cloud'
import type { RuntimeEnvironmentAccountClaim } from '../../shared/runtime-environments'
import { isHiveAccountRuntimeCloudConnectable } from './hive-runtime-catalog'

const MAX_CACHED_REQUEST_CONNECTIONS = 32

type CachedClosableConnection = {
  connection: { close: () => void } | null
}

export function hiveAccountRuntimeDirectoryAuthorizationKey(state: {
  accountId: string | null
  sessionGeneration: number | null
}): string | null {
  return state.accountId && state.sessionGeneration !== null
    ? `${state.accountId}:${state.sessionGeneration}`
    : null
}

export function isHiveAccountRuntimeClaimCurrent(
  state: HiveAccountRuntimeDirectoryState,
  claim: RuntimeEnvironmentAccountClaim
): boolean {
  if (state.status === 'SIGNED_OUT' || state.status === 'DISABLED') {
    return false
  }
  const entry = state.items.find(
    (candidate) =>
      candidate.runtimeRecordId === claim.runtimeRecordId &&
      candidate.resourceVersion === claim.resourceVersion
  )
  return entry !== undefined && isHiveAccountRuntimeCloudConnectable(entry)
}

export function touchHiveAccountRuntimeRequestConnection<TKey, TValue>(
  connections: Map<TKey, TValue>,
  key: TKey,
  value: TValue
): void {
  connections.delete(key)
  connections.set(key, value)
}

export function evictHiveAccountRuntimeRequestConnections<
  TKey,
  TValue extends CachedClosableConnection
>(connections: Map<TKey, TValue>, configuredLimit?: number): void {
  const limit =
    typeof configuredLimit === 'number' &&
    Number.isSafeInteger(configuredLimit) &&
    configuredLimit > 0
      ? configuredLimit
      : MAX_CACHED_REQUEST_CONNECTIONS
  while (connections.size >= limit) {
    const oldest = connections.entries().next().value as [TKey, TValue] | undefined
    if (!oldest) {
      return
    }
    connections.delete(oldest[0])
    oldest[1].connection?.close()
  }
}
