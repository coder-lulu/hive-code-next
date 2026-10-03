import type { AccountRuntimeClientRegistration } from './account-runtime-client-registry'
import { accountRuntimeCredentialsValid } from './account-runtime-connectability'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'

export function invalidateAccountRuntimeClients(
  clients: readonly AccountRuntimeClientRegistration[],
  disconnect: (hostId: string) => void,
  refresh: (hostId: string) => void
): void {
  for (const client of clients) {
    invalidateClient(client, disconnect, refresh)
  }
}

export function reconcileAccountRuntimeClients(
  entries: readonly AccountRuntimeDirectoryEntry[],
  clients: readonly AccountRuntimeClientRegistration[],
  disconnect: (hostId: string) => void,
  refresh: (hostId: string) => void
): void {
  const byRuntimeId = new Map(entries.map((entry) => [entry.runtimeRecordId, entry]))
  for (const client of clients) {
    const entry = byRuntimeId.get(client.runtimeRecordId)
    if (!entry || !accountRuntimeCredentialsValid(entry)) {
      invalidateClient(client, disconnect, refresh)
    } else if (entry.resourceVersion !== client.resourceVersion) {
      refresh(client.hostId)
    }
  }
}

function invalidateClient(
  client: AccountRuntimeClientRegistration,
  disconnect: (hostId: string) => void,
  refresh: (hostId: string) => void
): void {
  if (client.accessMode === 'local-fallback') {
    refresh(client.hostId)
  } else {
    disconnect(client.hostId)
  }
}
