import type { HostCatalogEntry } from '../transport/types'
import { hostCatalogEntryHasLocalPairing } from './account-runtime-catalog'

export function hostCatalogTargetsMatch(
  snapshot: HostCatalogEntry,
  current: HostCatalogEntry | undefined
): boolean {
  return Boolean(
    current &&
    snapshot.id === current.id &&
    snapshot.runtimeRecordId === current.runtimeRecordId &&
    hostCatalogEntryHasLocalPairing(snapshot) === hostCatalogEntryHasLocalPairing(current) &&
    Boolean(snapshot.accessSources?.includes('account-claimed')) ===
      Boolean(current.accessSources?.includes('account-claimed')) &&
    snapshot.credentialStatus === current.credentialStatus &&
    snapshot.endpoint === current.endpoint &&
    snapshot.publicKeyB64 === current.publicKeyB64 &&
    Boolean(snapshot.profile) === Boolean(current.profile) &&
    snapshot.profile?.id === current.profile?.id &&
    snapshot.profile?.endpoint === current.profile?.endpoint &&
    snapshot.profile?.publicKeyB64 === current.profile?.publicKeyB64 &&
    snapshot.profile?.deviceToken === current.profile?.deviceToken &&
    snapshot.profile?.runtimeRecordId === current.profile?.runtimeRecordId &&
    snapshot.profile?.accountRuntime?.runtimeRecordId ===
      current.profile?.accountRuntime?.runtimeRecordId &&
    snapshot.profile?.accountRuntime?.resourceVersion ===
      current.profile?.accountRuntime?.resourceVersion
  )
}
