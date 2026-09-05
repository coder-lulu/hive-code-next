import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'

export function accountRuntimeCanRequestConnection(entry: AccountRuntimeDirectoryEntry): boolean {
  return (
    entry.presence === 'ONLINE' &&
    entry.readiness === 'READY' &&
    accountRuntimeCredentialsValid(entry) &&
    entry.connectionCapabilities.includes('hive-relay')
  )
}

export function accountRuntimeCredentialsValid(entry: AccountRuntimeDirectoryEntry): boolean {
  return (
    entry.clientAuthMode === 'IDENTITY_PROOF' &&
    (entry.credentialState === 'ACTIVE' || entry.credentialState === 'EXPIRING')
  )
}
