import type { HiveAccountRuntimeDirectoryEntry } from './hive-runtime-cloud'

type HiveRuntimeConnectivityState = Pick<
  HiveAccountRuntimeDirectoryEntry,
  'clientAuthMode' | 'connectionCapabilities' | 'credentialState' | 'presence' | 'readiness'
>

const INVALID_CREDENTIAL_STATES = new Set([
  'EXPIRED',
  'REVOKED',
  'COMPROMISED',
  'IDENTITY_PROOF',
  'UNAVAILABLE'
])

const RELAY_CAPABILITIES = new Set([
  'hive-relay',
  'orca-relay',
  'CLOUD_RELAY',
  'cloud-relay',
  'relay'
])

function hasUsableCredential(entry: HiveRuntimeConnectivityState): boolean {
  return entry.credentialState === 'ACTIVE' || entry.credentialState === 'EXPIRING'
}

export function isHiveRuntimeCredentialInvalid(
  entry: HiveRuntimeConnectivityState | null
): boolean {
  return Boolean(entry && INVALID_CREDENTIAL_STATES.has(entry.credentialState))
}

export function isHiveRuntimeControlPlaneOnline(
  entry: HiveRuntimeConnectivityState | null
): boolean {
  return Boolean(
    entry &&
    hasUsableCredential(entry) &&
    entry.presence === 'ONLINE' &&
    entry.readiness === 'READY'
  )
}

export function hasHiveRuntimeRelayCapability(entry: HiveRuntimeConnectivityState | null): boolean {
  return Boolean(
    entry?.connectionCapabilities.some((capability) => RELAY_CAPABILITIES.has(capability))
  )
}

export function isHiveRuntimeCrossDeviceConnectable(
  entry: HiveRuntimeConnectivityState | null
): boolean {
  return Boolean(
    isHiveRuntimeControlPlaneOnline(entry) &&
    entry?.clientAuthMode === 'IDENTITY_PROOF' &&
    hasHiveRuntimeRelayCapability(entry)
  )
}
