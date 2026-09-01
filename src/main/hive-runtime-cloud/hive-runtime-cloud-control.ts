import type {
  HiveLocalRuntimeClaimPollResult,
  HiveLocalRuntimeClaimStartResult,
  HiveLocalRuntimeCloudStatus,
  HiveLocalRuntimeIdentityResetResult
} from '../../shared/hive-runtime-cloud'

export type HiveRuntimeCloudControl = Readonly<{
  getLocalRuntimeStatus: () => HiveLocalRuntimeCloudStatus
  beginHeadlessClaim: () => Promise<HiveLocalRuntimeClaimStartResult>
  pollHeadlessClaim: (challengeId: string) => Promise<HiveLocalRuntimeClaimPollResult>
  resetCloudIdentity: () => HiveLocalRuntimeIdentityResetResult
}>
