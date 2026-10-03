export type HiveRuntimeRelayTransitionType =
  | 'ACTIVATE'
  | 'ABANDON'
  | 'CLOSE'
  | 'IDLE_EXPIRE'
  | 'AUTHORITY_EXPIRE'
export type HiveRuntimeRelayTransitionReason =
  | 'ACTIVATED'
  | 'ABANDONED_BEFORE_ACTIVATION'
  | 'CLIENT_CLOSED'
  | 'RUNTIME_SHUTDOWN'
  | 'TRANSPORT_CLOSED'
  | 'LOCAL_ERROR'
  | 'IDLE_TIMEOUT'
  | 'SESSION_AUTHORITY_TIMEOUT'
export type HiveRuntimeRelaySessionTransition = Readonly<{
  sequence: number
  transitionId: string
  transitionType: HiveRuntimeRelayTransitionType
  managedSessionId: string
  runtimeSessionId: string
  expectedControlVersion: number
  sessionBindingHash: string
  occurredAt: number
  reason: HiveRuntimeRelayTransitionReason
}>
export type HiveRuntimeRelayTransitionInput = Omit<
  HiveRuntimeRelaySessionTransition,
  'sequence' | 'transitionId'
>
export type HiveRuntimeRelayTransitionVerdict =
  | 'APPLIED'
  | 'REJECTED_NOT_FOUND'
  | 'REJECTED_BINDING'
  | 'REJECTED_STALE_VERSION'
  | 'REJECTED_ILLEGAL_STATE'
  | 'REJECTED_DEADLINE'
  | 'REJECTED_AUTHORITY'
  | 'TRANSITION_REPLAY_CONFLICT'
  | 'SEQUENCE_GAP'
export type HiveRuntimeRelayTransitionAdjudication = Readonly<{
  sequence: number
  transitionId: string
  verdict: HiveRuntimeRelayTransitionVerdict
  stored: boolean
  resultingStatus:
    | 'PENDING_ACTIVATION'
    | 'ACTIVE'
    | 'CLOSED'
    | 'EXPIRED'
    | 'UNVERIFIABLE'
    | 'REVOKE_PENDING'
    | 'REVOKED'
  resultingControlVersion: number
}>
export type HiveRuntimeRelayTransitionAcknowledgement = Readonly<{
  ackedSessionTransitionSequence: number
  sessionTransitionResults: readonly HiveRuntimeRelayTransitionAdjudication[]
}>
export type HiveRuntimeRelayTransitionSettlement = Readonly<{
  transition: HiveRuntimeRelaySessionTransition
  result: HiveRuntimeRelayTransitionAdjudication
  activationEligible: boolean
}>
export type HiveRuntimeRelayTransitionHandle = Readonly<{
  transition: HiveRuntimeRelaySessionTransition
  completion: Promise<HiveRuntimeRelayTransitionSettlement>
}>
export type HiveRuntimeRelayTransitionEntry = {
  transition: HiveRuntimeRelaySessionTransition
  payloadSha256: string
  result?: HiveRuntimeRelayTransitionAdjudication
}
export type HiveRuntimeRelayTransitionState = {
  version: 'hiverelay-session-transition-outbox/v1'
  runtimeId: string
  runtimeBootId: string
  nextSequence: number
  highestAck: number
  entries: HiveRuntimeRelayTransitionEntry[]
}
