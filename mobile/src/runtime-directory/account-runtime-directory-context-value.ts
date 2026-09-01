import type { HostCatalogEntry } from '../transport/types'
import type {
  AccountRuntimeDirectoryScope,
  AccountRuntimeDirectoryState,
  RuntimeSession
} from './account-runtime-directory-types'

export type AccountRuntimeDisplayNameQueueRequest = Readonly<{
  runtimeRecordId: string
  desiredName: string | null
  expectedScope: AccountRuntimeDirectoryScope
  expectedResourceVersion: number
  expectedCloudDisplayNameVersion: number
}>

export type AccountRuntimeDirectoryContextValue = {
  readonly state: AccountRuntimeDirectoryState
  readonly mergeCatalog: (localCatalog: readonly HostCatalogEntry[]) => HostCatalogEntry[]
  readonly refresh: () => Promise<void>
  readonly listSessions: () => Promise<RuntimeSession[]>
  readonly revokeSession: (session: RuntimeSession) => Promise<RuntimeSession>
  readonly pendingDisplayNames: ReadonlyMap<string, string | null>
  readonly queueDisplayNameUpdate: (request: AccountRuntimeDisplayNameQueueRequest) => Promise<void>
}
