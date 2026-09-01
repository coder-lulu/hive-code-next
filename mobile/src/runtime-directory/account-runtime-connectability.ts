import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'

const RELAY_CAPABILITIES = new Set([
  'hive-relay',
  'orca-relay',
  'CLOUD_RELAY',
  'cloud-relay',
  'relay'
])

export function accountRuntimeCanRequestConnection(entry: AccountRuntimeDirectoryEntry): boolean {
  return (
    entry.presence === 'ONLINE' &&
    entry.readiness === 'READY' &&
    accountRuntimeCredentialsValid(entry) &&
    entry.connectionCapabilities.some((capability) => RELAY_CAPABILITIES.has(capability))
  )
}

export function accountRuntimeCredentialsValid(entry: AccountRuntimeDirectoryEntry): boolean {
  return (
    entry.clientAuthMode === 'IDENTITY_PROOF' &&
    (entry.credentialState === 'ACTIVE' || entry.credentialState === 'EXPIRING')
  )
}
