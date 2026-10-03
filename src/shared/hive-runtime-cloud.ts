import { isHiveRuntimeCrossDeviceConnectable } from './hive-runtime-connectivity'
import type { RuntimeEnvironmentAccountClaim } from './runtime-environments'

export const HIVE_RUNTIME_DIRECTORY_CHANGED_CHANNEL = 'hiveRuntimeCloud:directoryChanged'
export const HIVE_RUNTIME_OWNERSHIP_CHANGED_CHANNEL = 'hiveRuntimeCloud:ownershipChanged'

export type HiveRuntimeOwnershipRelation =
  | 'ANALYZING'
  | 'UNREGISTERED'
  | 'PENDING_CLAIM'
  | 'CLAIMED_BY_CURRENT'
  | 'CLAIMED_BY_OTHER'
  | 'TRANSFER_PENDING'
  | 'UNVERIFIABLE'

export type HiveRuntimeDirectoryPresence = 'ONLINE' | 'DEGRADED' | 'OFFLINE'

export type HiveRuntimeDirectoryReadiness =
  | 'STARTING'
  | 'READY'
  | 'DEGRADED'
  | 'RECOVERING'
  | 'STOPPED'
  | 'ERROR'

export type HiveRuntimeCredentialState =
  | 'ACTIVE'
  | 'EXPIRING'
  | 'ROTATING'
  | 'EXPIRED'
  | 'REVOKED'
  | 'COMPROMISED'
  | 'IDENTITY_PROOF'
  | 'UNAVAILABLE'

export type HiveAccountRuntimeDirectoryEntry = Readonly<{
  runtimeRecordId: string
  status: 'CLAIMED'
  runtimeVersion: string
  runtimeProtocolVersion: 2 | 3
  capabilities: readonly string[]
  resourceVersion: number
  createdAt: number
  updatedAt: number
  claimedAt: number | null
  presence: HiveRuntimeDirectoryPresence
  readiness: HiveRuntimeDirectoryReadiness | null
  readinessReasonCode: string | null
  lastHeartbeatAt: number | null
  observedAt: number | null
  freeDiskBytes: number | null
  clientAuthMode: 'MTLS' | 'IDENTITY_PROOF' | null
  credentialState: HiveRuntimeCredentialState
  connectionCapabilities: readonly string[]
  cloudDisplayName?: string | null
  cloudDisplayNameVersion?: number | null
  deviceName?: string | null
  osName?: string | null
  osVersion?: string | null
  osArch?: string | null
  cpuModel?: string | null
  cpuLogicalCores?: number | null
  totalMemoryBytes?: number | null
  lastSeenIp?: string | null
}>

export function projectHiveRuntimeAccountClaim(
  runtime: HiveAccountRuntimeDirectoryEntry
): RuntimeEnvironmentAccountClaim {
  return {
    runtimeRecordId: runtime.runtimeRecordId,
    resourceVersion: runtime.resourceVersion,
    presence: runtime.presence,
    readiness: runtime.readiness,
    readinessReasonCode: runtime.readinessReasonCode,
    lastHeartbeatAt: runtime.lastHeartbeatAt,
    freeDiskBytes: runtime.freeDiskBytes,
    clientAuthMode: runtime.clientAuthMode,
    credentialState: runtime.credentialState,
    connectionCapabilities: runtime.connectionCapabilities,
    cloudConnectable: isHiveRuntimeCrossDeviceConnectable(runtime),
    cloudDisplayName: runtime.cloudDisplayName,
    cloudDisplayNameVersion: runtime.cloudDisplayNameVersion,
    reportedDeviceName: runtime.deviceName
  }
}

export type HiveAccountRuntimeDirectoryState = Readonly<{
  status: 'SIGNED_OUT' | 'DISABLED' | 'LOADING' | 'READY' | 'STALE' | 'ERROR'
  accountId: string | null
  sessionGeneration: number | null
  items: readonly HiveAccountRuntimeDirectoryEntry[]
  lastSyncedAt: number | null
  errorCode: string | null
  pendingDisplayNames?: readonly HiveRuntimePendingDisplayName[]
}>

export type HiveRuntimePendingDisplayName = Readonly<{
  runtimeRecordId: string
  desiredName: string | null
  revision: number
  confirmed: boolean
}>

export type HiveRuntimeDisplayNameUpdateRequest = Readonly<{
  runtimeRecordId: string
  cloudDisplayName: string | null
  expectedCloudDisplayNameVersion: number
}>

export type HiveLocalRuntimeOwnershipState = Readonly<{
  claimUserCode?: string
  stateRevision: number
  relation: HiveRuntimeOwnershipRelation
  accountId: string | null
  sessionGeneration: number | null
  runtimeRecordId: string | null
  claimCapabilityAvailable: boolean
  presence:
    | 'DISABLED'
    | 'WAITING_RUNTIME'
    | 'CLAIM_PENDING'
    | 'LEASED'
    | 'ONLINE'
    | 'OFFLINE_RETRY'
    | 'FENCED'
    | 'STOPPED'
  checkedAt: number | null
  errorCode: string | null
}>

export type HiveLocalRuntimeClaimRequest = Readonly<{
  expectedAccountId: string
}>

export type HiveLocalRuntimeRegistrationStatus =
  | 'DISABLED'
  | 'UNREGISTERED'
  | 'PENDING_CLAIM'
  | 'CLAIMED'
  | 'UNVERIFIABLE'

export type HiveLocalRuntimeCloudStatus = Readonly<{
  ownership: HiveLocalRuntimeRegistrationStatus
  presence: HiveLocalRuntimeOwnershipState['presence']
  runtimeRecordId: string | null
  relay: 'connecting' | 'registered' | 'standby' | 'draining' | 'offline'
}>

export type HiveLocalRuntimeClaimStartResult =
  | Readonly<{
      status: 'CLAIMED'
      runtimeRecordId: string
    }>
  | Readonly<{
      status: 'PENDING'
      runtimeRecordId: string
      challengeId: string
      userCode: string
      verificationUri: string
      expiresAt: number
      pollIntervalSeconds: number
    }>

export type HiveLocalRuntimeClaimPollResult =
  | Readonly<{
      status: 'PENDING'
      challengeId: string
      nextPollAt: number
    }>
  | Readonly<{
      status: 'CLAIMED'
      runtimeRecordId: string
    }>
  | Readonly<{
      status: 'EXPIRED'
      challengeId: string
    }>

export type HiveLocalRuntimeIdentityResetResult = Readonly<{
  reset: true
}>

export type HiveRuntimeSessionStatus =
  | 'PENDING_ACTIVATION'
  | 'ACTIVE'
  | 'CLOSED'
  | 'REVOKE_PENDING'
  | 'REVOKED'
  | 'EXPIRED'
  | 'UNVERIFIABLE'

export type HiveRuntimeSession = Readonly<{
  managedSessionId: string
  runtimeRecordId: string
  runtimeInstanceId: string
  runtimeSessionId: string
  clientKind: 'WEB' | 'DESKTOP' | 'MOBILE'
  clientLabel: string | null
  status: HiveRuntimeSessionStatus
  resourceVersion: number
  controlVersion: number
  createdAt: number
  expiresAt: number
  revokeRequestedAt: number | null
  revokeAcknowledgedAt: number | null
}>

export type HiveRuntimeSessionPage = Readonly<{
  items: readonly HiveRuntimeSession[]
  nextCursor: string | null
}>

export type HiveRuntimeSessionRevokeRequest = Readonly<{
  managedSessionId: string
  expectedResourceVersion: number
}>

export type HiveRuntimeSessionRevocation = Readonly<{
  managedSessionId: string
  status: HiveRuntimeSessionStatus
  resourceVersion: number
  controlVersion: number
}>

export const EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY: HiveAccountRuntimeDirectoryState = {
  status: 'SIGNED_OUT',
  accountId: null,
  sessionGeneration: null,
  items: [],
  lastSyncedAt: null,
  errorCode: null,
  pendingDisplayNames: []
}

export const EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP: HiveLocalRuntimeOwnershipState = {
  stateRevision: 0,
  relation: 'UNVERIFIABLE',
  accountId: null,
  sessionGeneration: null,
  runtimeRecordId: null,
  claimCapabilityAvailable: false,
  presence: 'WAITING_RUNTIME',
  checkedAt: null,
  errorCode: null
}
