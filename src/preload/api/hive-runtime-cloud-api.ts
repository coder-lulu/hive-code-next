import type {
  HiveAccountRuntimeDirectoryState,
  HiveLocalRuntimeClaimRequest,
  HiveLocalRuntimeOwnershipState,
  HiveRuntimeDisplayNameUpdateRequest,
  HiveRuntimeSession,
  HiveRuntimeSessionRevokeRequest
} from '../../shared/hive-runtime-cloud'

export type HiveRuntimeCloudApi = {
  getDirectory: () => Promise<HiveAccountRuntimeDirectoryState>
  refreshDirectory: () => Promise<HiveAccountRuntimeDirectoryState>
  updateDisplayName: (
    request: HiveRuntimeDisplayNameUpdateRequest
  ) => Promise<HiveAccountRuntimeDirectoryState>
  getLocalOwnership: () => Promise<HiveLocalRuntimeOwnershipState>
  refreshLocalOwnership: () => Promise<HiveLocalRuntimeOwnershipState>
  claimLocalRuntime: (
    request: HiveLocalRuntimeClaimRequest
  ) => Promise<HiveLocalRuntimeOwnershipState>
  listSessions: () => Promise<readonly HiveRuntimeSession[]>
  revokeSession: (request: HiveRuntimeSessionRevokeRequest) => Promise<HiveRuntimeSession>
  onDirectoryChanged: (callback: (state: HiveAccountRuntimeDirectoryState) => void) => () => void
  onOwnershipChanged: (callback: (state: HiveLocalRuntimeOwnershipState) => void) => () => void
}
