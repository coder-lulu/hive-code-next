import {
  projectHiveRuntimeAccountClaim,
  type HiveAccountRuntimeDirectoryEntry
} from '../../shared/hive-runtime-cloud'
import { resolveHiveRuntimeDisplayName } from '../../shared/hive-runtime-display-name'
import {
  hasHiveRuntimeRelayCapability,
  isHiveRuntimeCrossDeviceConnectable
} from '../../shared/hive-runtime-connectivity'
import type { PublicKnownRuntimeEnvironment } from '../../shared/runtime-environments'

const ACCOUNT_ENVIRONMENT_PREFIX = 'account-runtime:'
export function accountRuntimeEnvironmentId(runtimeRecordId: string): string {
  return `${ACCOUNT_ENVIRONMENT_PREFIX}${runtimeRecordId}`
}

export function runtimeRecordIdFromAccountEnvironmentId(environmentId: string): string | null {
  if (!environmentId.startsWith(ACCOUNT_ENVIRONMENT_PREFIX)) {
    return null
  }
  const runtimeRecordId = environmentId.slice(ACCOUNT_ENVIRONMENT_PREFIX.length)
  return runtimeRecordId.length > 0 ? runtimeRecordId : null
}

/**
 * Builds the user-facing catalog without ever persisting an account row in the
 * local pairing store. A local row and an account row merge only when the local
 * Runtime has explicitly reported the same cloud runtimeRecordId.
 */
export function mergeHiveAccountRuntimeCatalog(
  localEnvironments: readonly PublicKnownRuntimeEnvironment[],
  accountRuntimes: readonly HiveAccountRuntimeDirectoryEntry[],
  pendingDisplayNames: ReadonlyMap<string, string | null> = new Map()
): PublicKnownRuntimeEnvironment[] {
  const merged = localEnvironments.map<PublicKnownRuntimeEnvironment>((environment) => ({
    ...environment,
    accessSources: ['local-pairing']
  }))
  const localByRuntimeRecordId = new Map<string, number>()
  for (let index = 0; index < merged.length; index++) {
    const runtimeRecordId = merged[index]?.runtimeRecordId
    if (runtimeRecordId) {
      localByRuntimeRecordId.set(runtimeRecordId, index)
    }
  }

  for (const runtime of accountRuntimes) {
    const accountClaim = projectHiveRuntimeAccountClaim(runtime)
    const localIndex = localByRuntimeRecordId.get(runtime.runtimeRecordId)
    if (localIndex !== undefined) {
      const local = merged[localIndex]!
      merged[localIndex] = {
        ...local,
        name: resolveHiveRuntimeDisplayName({
          ...(pendingDisplayNames.has(runtime.runtimeRecordId)
            ? { pendingDesiredName: pendingDisplayNames.get(runtime.runtimeRecordId)! }
            : {}),
          cloudDisplayName: runtime.cloudDisplayName,
          localPairedName: local.name,
          reportedDeviceName: runtime.deviceName,
          runtimeRecordId: runtime.runtimeRecordId
        }),
        runtimeRecordId: runtime.runtimeRecordId,
        accessSources: ['local-pairing', 'account-claimed'],
        accountClaim
      }
      continue
    }
    merged.push(accountOnlyEnvironment(runtime, accountClaim, pendingDisplayNames))
  }
  return merged
}

export function resolveHiveRuntimeCatalogEntry(
  localEnvironments: readonly PublicKnownRuntimeEnvironment[],
  accountRuntimes: readonly HiveAccountRuntimeDirectoryEntry[],
  pendingDisplayNames: ReadonlyMap<string, string | null>,
  selector: string
): PublicKnownRuntimeEnvironment {
  const localById = localEnvironments.find((entry) => entry.id === selector)
  if (localById) {
    return resolveLocalCatalogEntry(localById, accountRuntimes, pendingDisplayNames)
  }
  const accountRuntimeRecordId = runtimeRecordIdFromAccountEnvironmentId(selector) ?? selector
  const accountRuntime = accountRuntimes.find(
    (runtime) => runtime.runtimeRecordId === accountRuntimeRecordId
  )
  if (accountRuntime) {
    const linkedLocal = localEnvironments.findLast(
      (entry) => entry.runtimeRecordId === accountRuntime.runtimeRecordId
    )
    return mergeHiveAccountRuntimeCatalog(
      linkedLocal ? [linkedLocal] : [],
      [accountRuntime],
      pendingDisplayNames
    )[0]!
  }
  // Local pairing names remain a compatibility selector. Resolve them from
  // the persisted local source, never from the merged presentation name,
  // because cloud display names are mutable labels rather than identity.
  const localMatches = localEnvironments.filter((entry) => entry.name === selector)
  if (localMatches.length === 1) {
    return resolveLocalCatalogEntry(localMatches[0]!, accountRuntimes, pendingDisplayNames)
  }
  if (localMatches.length > 1) {
    throw new Error(`Runtime environment name "${selector}" is ambiguous; use the environment id.`)
  }
  throw new Error(`Unknown Runtime environment: ${selector}`)
}

function resolveLocalCatalogEntry(
  local: PublicKnownRuntimeEnvironment,
  accountRuntimes: readonly HiveAccountRuntimeDirectoryEntry[],
  pendingDisplayNames: ReadonlyMap<string, string | null>
): PublicKnownRuntimeEnvironment {
  const accountRuntime = local.runtimeRecordId
    ? accountRuntimes.find((runtime) => runtime.runtimeRecordId === local.runtimeRecordId)
    : undefined
  return mergeHiveAccountRuntimeCatalog(
    [local],
    accountRuntime ? [accountRuntime] : [],
    pendingDisplayNames
  )[0]!
}

function accountOnlyEnvironment(
  runtime: HiveAccountRuntimeDirectoryEntry,
  accountClaim: ReturnType<typeof projectHiveRuntimeAccountClaim>,
  pendingDisplayNames: ReadonlyMap<string, string | null>
): PublicKnownRuntimeEnvironment {
  const id = accountRuntimeEnvironmentId(runtime.runtimeRecordId)
  const endpointId = `cloud-${runtime.runtimeRecordId}`
  return {
    id,
    name: resolveHiveRuntimeDisplayName({
      ...(pendingDisplayNames.has(runtime.runtimeRecordId)
        ? { pendingDesiredName: pendingDisplayNames.get(runtime.runtimeRecordId)! }
        : {}),
      cloudDisplayName: runtime.cloudDisplayName,
      reportedDeviceName: runtime.deviceName,
      runtimeRecordId: runtime.runtimeRecordId
    }),
    createdAt: runtime.createdAt,
    updatedAt: runtime.updatedAt,
    pairingRevision: runtime.resourceVersion,
    lastUsedAt: runtime.lastHeartbeatAt,
    runtimeId: null,
    runtimeRecordId: runtime.runtimeRecordId,
    endpoints: [
      {
        id: endpointId,
        kind: 'websocket',
        label: hasHiveRuntimeRelayCapability(runtime) ? 'HiveCloud Relay' : 'HiveCloud Runtime',
        endpoint: `cloud://${runtime.runtimeRecordId}`
      }
    ],
    preferredEndpointId: endpointId,
    accessSources: ['account-claimed'],
    accountClaim
  }
}

export function isHiveAccountRuntimeCloudConnectable(
  runtime: HiveAccountRuntimeDirectoryEntry
): boolean {
  return isHiveRuntimeCrossDeviceConnectable(runtime)
}
