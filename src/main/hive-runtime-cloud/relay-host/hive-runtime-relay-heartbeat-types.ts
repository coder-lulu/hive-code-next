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
}>
export type HiveRuntimeRelayHeartbeatCommand = Readonly<{
  sequence: number
  commandId: string
  commandType: 'SESSION_REVOKE'
  managedSessionId: string
  assignmentId: string
  targetResourceVersion: number
  targetControlVersion: number
  reason:
    | 'ACCOUNT_SESSION_REVOKED'
    | 'ACCOUNT_DEVICE_REVOKED'
    | 'ACCOUNT_DELETION'
    | 'RUNTIME_AUTHORITY_REVOKED'
    | 'RUNTIME_CREDENTIAL_REVOKED'
    | 'ADMINISTRATIVE'
}>
export type HiveRuntimeRelayHeartbeatResponseControl = Readonly<{
  responseVersion: 'runtime-session-control/v1'
  ackedSessionTransitionSequence: number
  sessionTransitionResults: readonly HiveRuntimeRelayTransitionAdjudication[]
  sessionAuthorityUntil: number | null
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
