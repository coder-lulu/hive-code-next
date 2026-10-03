import type { CurrentHiveRuntimeCloudLeaseContext } from '../hive-runtime-cloud-lease-context'
import type {
  HiveRuntimeRelaySessionTransition,
  HiveRuntimeRelayTransitionAdjudication
} from './hive-runtime-relay-session-transition-types'

export type HiveRuntimeRelayControlCommandAck = Readonly<{
  sequence: number
  commandId: string
  acknowledgedResourceVersion: number
}>
export type HiveRuntimeRelayHeartbeatControl = Readonly<{
  assignmentId: string
  cellId: string
  cellIncarnationId: string
  assignmentEpoch: number
  controlGeneration: number
  controlConnectionAcknowledged: boolean
  controlCommandAck: HiveRuntimeRelayControlCommandAck | null
  sessionTransitions: readonly HiveRuntimeRelaySessionTransition[]
  activeConnectionCount: number
  regionSelectionMode: 'DYNAMIC' | 'ADMIN_OVERRIDE'
  regionMeasurement: HiveRuntimeRelayRegionMeasurement | null
}>
export type HiveRuntimeRelayRegionMeasurement = Readonly<{
  policyVersion: 1
  windowGeneration: number
  assignmentId: string
  assignmentEpoch: number
  incumbentRegion: string
  outcome: 'CONCLUSIVE' | 'INCONCLUSIVE'
  measurements: readonly HiveRuntimeRelayRegionLatency[]
  failure: 'TIMEOUT' | 'NETWORK_ERROR' | 'INCOMPLETE' | null
}>
export type HiveRuntimeRelayRegionLatency = Readonly<{
  region: string
  latencyMillis: number
}>
export type HiveRuntimeRelayRegionCandidate = Readonly<{
  region: string
  probeUrl: string
}>
export type HiveRuntimeRelayRegionMeasurementWindow = Readonly<{
  policyVersion: 1
  generation: number
  expiresAt: number
  assignmentId: string
  assignmentEpoch: number
  incumbentRegion: string
  candidates: readonly HiveRuntimeRelayRegionCandidate[]
}>
export type HiveRuntimeRelaySessionRevokeCommand = Readonly<{
  sequence: number
  commandId: string
  commandType: 'SESSION_REVOKE'
  managedSessionId: string
  assignmentId: string
  assignmentEpoch: null
  targetResourceVersion: number
  targetControlVersion: number
  reason:
    | 'ACCOUNT_SESSION_REVOKED'
    | 'ACCOUNT_DEVICE_REVOKED'
    | 'ACCOUNT_DELETION'
    | 'RUNTIME_AUTHORITY_REVOKED'
    | 'RUNTIME_CREDENTIAL_REVOKED'
    | 'ADMINISTRATIVE'
  targetRegion: null
}>
export type HiveRuntimeRelayRehomeCommand = Readonly<{
  sequence: number
  commandId: string
  commandType: 'RELAY_REHOME'
  managedSessionId: null
  assignmentId: string
  assignmentEpoch: number
  targetResourceVersion: number
  targetControlVersion: null
  reason: null
  targetRegion: string
}>
export type HiveRuntimeRelayHeartbeatCommand =
  | HiveRuntimeRelaySessionRevokeCommand
  | HiveRuntimeRelayRehomeCommand
export type HiveRuntimeRelayHeartbeatResponseControl = Readonly<{
  responseVersion: 'runtime-session-control/v1'
  ackedSessionTransitionSequence: number
  sessionTransitionResults: readonly HiveRuntimeRelayTransitionAdjudication[]
  sessionAuthorityUntil: number | null
  regionMeasurementWindow: HiveRuntimeRelayRegionMeasurementWindow | null
  ackedControlSequence: number
  controlCommands: readonly HiveRuntimeRelayHeartbeatCommand[]
  nextControlSequence: number
}>
export type HiveRuntimeRelayHeartbeatSnapshot = Readonly<{
  relayControl: HiveRuntimeRelayHeartbeatControl
  advertiseRelay: boolean
}>
export type HiveRuntimeRelayHeartbeatContributor = {
  snapshot(context: CurrentHiveRuntimeCloudLeaseContext): HiveRuntimeRelayHeartbeatSnapshot | null
  accept(
    context: CurrentHiveRuntimeCloudLeaseContext,
    response: HiveRuntimeRelayHeartbeatResponseControl & { observedAt: number },
    sent: HiveRuntimeRelayHeartbeatControl
  ): void
}
