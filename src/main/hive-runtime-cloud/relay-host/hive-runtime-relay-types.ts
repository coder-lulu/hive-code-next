import type {
  CurrentHiveRuntimeCloudLeaseContext,
  HiveRuntimeCloudTuple
} from '../hive-runtime-cloud-lease-context'

declare const directorToken: unique symbol
declare const cellLease: unique symbol
export type RelayTokenForDirector = string & { readonly [directorToken]: true }
export type ControlLeaseForCell = string & { readonly [cellLease]: true }

export type HiveRuntimeRelayHostBinding = Readonly<{
  relayHostId: string
  hostBindingVersion: number
  hostPublicKeyB64: string
}>

export type HiveRuntimeRelayAssignment = Readonly<{
  context: CurrentHiveRuntimeCloudLeaseContext
  binding: HiveRuntimeRelayHostBinding
  cellOrigin: string
  cellId: string
  cellIncarnationId: string
  assignmentId: string
  assignmentEpoch: number
  controlGeneration: number
  relayHostId: string
  controlLease: ControlLeaseForCell
  controlLeaseExpiresAt: number
  hostPublicKeyB64: string
}>

export type HiveRuntimeRelayConsumeInput = Readonly<{
  consumeAttemptId: string
  ticketSecret: string
  intentId: string
  assignmentId: string
  assignmentEpoch: number
  controlGeneration: number
  cellId: string
  cellIncarnationId: string
  connId: string
  clientKeyHash: string
  e2eeTranscriptHash: string
  sessionBindingHash: string
}>

export type HiveRuntimeRelayConsumeResult = Readonly<{
  protocolVersion: 'account-runtime-ticket-consume/v2'
  managedSessionId: string
  runtimeSessionId: string
  operationCallerKey: string
  status: 'PENDING_ACTIVATION'
  activationDeadlineAt: number
  absoluteExpiresAt: number
  controlVersion: number
}>

export function hiveRuntimeRelayTuplesEqual(
  a: HiveRuntimeCloudTuple,
  b: HiveRuntimeCloudTuple
): boolean {
  return (
    a.runtimeRecordId === b.runtimeRecordId &&
    a.runtimeInstanceId === b.runtimeInstanceId &&
    a.bootId === b.bootId &&
    a.heartbeatLeaseId === b.heartbeatLeaseId &&
    a.authorityGeneration === b.authorityGeneration &&
    a.leaseEpoch === b.leaseEpoch &&
    a.fencingEpoch === b.fencingEpoch
  )
}
