import type { HostCatalogEntry, HostProfile } from '../transport/types'
import { resolveHiveRuntimeDisplayName } from '../../../src/shared/hive-runtime-display-name'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'

type CloudProfileFactory = (entry: AccountRuntimeDirectoryEntry) => HostProfile | null

export function hostCatalogEntryHasLocalPairing(
  entry: Pick<HostCatalogEntry, 'accessSources'>
): boolean {
  // Legacy local rows predate accessSources. Account-projected rows always set
  // it explicitly, so an omitted value remains a removable local pairing.
  return entry.accessSources === undefined || entry.accessSources.includes('manual-pairing')
}

export function mergeAccountRuntimeCatalog(
  localCatalog: readonly HostCatalogEntry[],
  accountRuntimes: readonly AccountRuntimeDirectoryEntry[],
  cloudProfile: CloudProfileFactory,
  pendingDisplayNames: ReadonlyMap<string, string | null> = new Map()
): HostCatalogEntry[] {
  const merged = localCatalog.map<HostCatalogEntry>((entry) => ({
    ...entry,
    accessSources: entry.accessSources ?? ['manual-pairing']
  }))
  const localByRuntimeId = new Map<string, number>()
  merged.forEach((entry, index) => {
    if (entry.runtimeRecordId) {
      localByRuntimeId.set(entry.runtimeRecordId, index)
    }
  })

  for (const runtime of accountRuntimes) {
    const profile = cloudProfile(runtime)
    const localIndex = localByRuntimeId.get(runtime.runtimeRecordId)
    if (localIndex !== undefined) {
      const local = merged[localIndex]!
      const compositeProfile = mergeLocalProfileWithAccountRoute(local.profile, profile, local)
      merged[localIndex] = {
        ...local,
        name: effectiveRuntimeName(runtime, local.name, pendingDisplayNames),
        ...(compositeProfile
          ? {
              endpoint: compositeProfile.endpoint,
              publicKeyB64: compositeProfile.publicKeyB64,
              credentialStatus: 'ready' as const,
              profile: compositeProfile
            }
          : {}),
        accessSources: ['manual-pairing', 'account-claimed'],
        cloudProfile: profile ?? undefined,
        accountPresence: runtime.presence,
        accountReadiness: runtime.readiness
      }
      continue
    }
    merged.push(accountOnlyCatalogEntry(runtime, profile, pendingDisplayNames))
  }
  return merged
}

function mergeLocalProfileWithAccountRoute(
  localProfile: HostProfile | null,
  cloudProfile: HostProfile | null,
  localEntry: HostCatalogEntry
): HostProfile | null {
  if (!cloudProfile?.accountRuntime) {
    return localProfile
  }
  if (localProfile) {
    return localProfile
  }
  return {
    ...cloudProfile,
    id: localEntry.id,
    name: localEntry.name,
    lastConnected: localEntry.lastConnected
  }
}

function accountOnlyCatalogEntry(
  runtime: AccountRuntimeDirectoryEntry,
  profile: HostProfile | null,
  pendingDisplayNames: ReadonlyMap<string, string | null>
): HostCatalogEntry {
  return {
    id: runtime.runtimeRecordId,
    runtimeRecordId: runtime.runtimeRecordId,
    name: effectiveRuntimeName(runtime, null, pendingDisplayNames),
    endpoint: profile?.endpoint ?? `cloud://${runtime.runtimeRecordId}`,
    publicKeyB64: profile?.publicKeyB64 ?? '',
    lastConnected: profile?.lastConnected ?? 0,
    credentialStatus: profile
      ? 'ready'
      : runtime.presence === 'OFFLINE'
        ? 'cloud-offline'
        : 'cloud-unavailable',
    profile,
    cloudProfile: profile ?? undefined,
    accessSources: ['account-claimed'],
    accountPresence: runtime.presence,
    accountReadiness: runtime.readiness
  }
}

function effectiveRuntimeName(
  runtime: AccountRuntimeDirectoryEntry,
  localPairedName: string | null,
  pendingDisplayNames: ReadonlyMap<string, string | null>
): string {
  return resolveHiveRuntimeDisplayName({
    ...(pendingDisplayNames.has(runtime.runtimeRecordId)
      ? { pendingDesiredName: pendingDisplayNames.get(runtime.runtimeRecordId)! }
      : {}),
    cloudDisplayName: runtime.cloudDisplayName,
    localPairedName,
    reportedDeviceName: runtime.deviceName,
    runtimeRecordId: runtime.runtimeRecordId
  })
}
