import type {
  HiveAccountRuntimeDirectoryState,
  HiveLocalRuntimeClaimRequest,
  HiveLocalRuntimeOwnershipState,
  HiveRuntimeDisplayNameUpdateRequest,
  HiveRuntimeDisplayNameDiscardRequest,
  HiveRuntimeSessionPage,
  HiveRuntimeSessionRevocation,
  HiveRuntimeSessionRevokeRequest
} from '../../shared/hive-runtime-cloud'

export type HiveRuntimeCloudApi = {
  getDirectory: () => Promise<HiveAccountRuntimeDirectoryState>
  refreshDirectory: () => Promise<HiveAccountRuntimeDirectoryState>
  updateDisplayName: (
    request: HiveRuntimeDisplayNameUpdateRequest
  ) => Promise<HiveAccountRuntimeDirectoryState>
  discardDisplayName: (
    request: HiveRuntimeDisplayNameDiscardRequest
  ) => Promise<HiveAccountRuntimeDirectoryState>
  getLocalOwnership: () => Promise<HiveLocalRuntimeOwnershipState>
  refreshLocalOwnership: () => Promise<HiveLocalRuntimeOwnershipState>
  claimLocalRuntime: (
    request: HiveLocalRuntimeClaimRequest
  ) => Promise<HiveLocalRuntimeOwnershipState>
  listSessions: (cursor?: string | null) => Promise<HiveRuntimeSessionPage>
  revokeSession: (request: HiveRuntimeSessionRevokeRequest) => Promise<HiveRuntimeSessionRevocation>
  onDirectoryChanged: (callback: (state: HiveAccountRuntimeDirectoryState) => void) => () => void
  onOwnershipChanged: (callback: (state: HiveLocalRuntimeOwnershipState) => void) => () => void
}
