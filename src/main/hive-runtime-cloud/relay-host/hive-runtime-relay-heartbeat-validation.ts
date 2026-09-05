import {
  isHiveRuntimeRelaySessionTransition,
  isHiveRuntimeRelayTransitionAdjudication,
  transitionInteger,
  transitionObject
} from './hive-runtime-relay-session-transition-validation'
import type {
  HiveRuntimeRelayHeartbeatCommand,
  HiveRuntimeRelayHeartbeatControl,
  HiveRuntimeRelayHeartbeatResponseControl
} from './hive-runtime-relay-heartbeat-types'

export const HIVE_RELAY_HEARTBEAT_RESPONSE_FIELDS = [
  'responseVersion',
  'ackedSessionTransitionSequence',
  'sessionTransitionResults',
  'sessionAuthorityUntil',
  'ackedControlSequence',
  'controlCommands',
  'nextControlSequence'
] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}
function positive(value: unknown): value is number {
  return transitionInteger(value) && value > 0
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return (
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  )
}
function command(value: unknown): value is HiveRuntimeRelayHeartbeatCommand {
  return (
    transitionObject(value) &&
    exact(value, [
      'sequence',
      'commandId',
      'commandType',
      'managedSessionId',
      'assignmentId',
      'targetResourceVersion',
      'targetControlVersion',
      'reason'
    ]) &&
    positive(value.sequence) &&
    uuid(value.commandId) &&
    value.commandType === 'SESSION_REVOKE' &&
    uuid(value.managedSessionId) &&
    uuid(value.assignmentId) &&
    positive(value.targetResourceVersion) &&
    positive(value.targetControlVersion) &&
    typeof value.reason === 'string' &&
    [
      'ACCOUNT_SESSION_REVOKED',
      'ACCOUNT_DEVICE_REVOKED',
      'ACCOUNT_DELETION',
      'RUNTIME_AUTHORITY_REVOKED',
      'RUNTIME_CREDENTIAL_REVOKED',
      'ADMINISTRATIVE'
    ].includes(value.reason)
  )
}
export function isHiveRuntimeRelayHeartbeatControl(
  value: unknown
): value is HiveRuntimeRelayHeartbeatControl {
  if (
    !transitionObject(value) ||
    !exact(value, [
      'assignmentId',
      'cellId',
      'cellIncarnationId',
      'assignmentEpoch',
      'controlGeneration',
      'controlConnectionAcknowledged',
      'controlCommandAck',
      'sessionTransitions'
    ])
  ) {
    return false
  }
  const ack = value.controlCommandAck
  return (
    uuid(value.assignmentId) &&
    uuid(value.cellIncarnationId) &&
    typeof value.cellId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.cellId) &&
    transitionInteger(value.assignmentEpoch) &&
    transitionInteger(value.controlGeneration) &&
    typeof value.controlConnectionAcknowledged === 'boolean' &&
    (ack === null ||
      (transitionObject(ack) &&
        exact(ack, ['sequence', 'commandId', 'acknowledgedResourceVersion']) &&
        positive(ack.sequence) &&
        uuid(ack.commandId) &&
        positive(ack.acknowledgedResourceVersion))) &&
    Array.isArray(value.sessionTransitions) &&
    value.sessionTransitions.length <= 128 &&
    value.sessionTransitions.every(isHiveRuntimeRelaySessionTransition) &&
    value.sessionTransitions.every(
      (entry, index, entries) => index === 0 || entry.sequence === entries[index - 1].sequence + 1
    )
  )
}
export function normalizeHiveRuntimeRelayHeartbeatResponse(
  value: Record<string, unknown>,
  observedAt: number
): HiveRuntimeRelayHeartbeatResponseControl {
  const expiry =
    value.sessionAuthorityUntil === null
      ? null
      : typeof value.sessionAuthorityUntil === 'string'
        ? Date.parse(value.sessionAuthorityUntil)
        : Number.NaN
  if (
    value.responseVersion !== 'runtime-session-control/v1' ||
    !transitionInteger(value.ackedSessionTransitionSequence) ||
    !transitionInteger(value.ackedControlSequence) ||
    !transitionInteger(value.nextControlSequence) ||
    (expiry !== null &&
      (!Number.isSafeInteger(expiry) || expiry <= observedAt || expiry > observedAt + 120_000)) ||
    !Array.isArray(value.sessionTransitionResults) ||
    value.sessionTransitionResults.length > 128 ||
    !value.sessionTransitionResults.every(isHiveRuntimeRelayTransitionAdjudication) ||
    !Array.isArray(value.controlCommands) ||
    value.controlCommands.length > 128 ||
    !value.controlCommands.every(command) ||
    !value.controlCommands.every(
      (entry, index) => entry.sequence === (value.ackedControlSequence as number) + index + 1
    ) ||
    value.nextControlSequence !== value.ackedControlSequence + value.controlCommands.length + 1 ||
    !Number.isSafeInteger(value.nextControlSequence)
  ) {
    throw new Error('invalid_hive_runtime_relay_heartbeat_response')
  }
  const transitions = value.sessionTransitionResults
  if (
    new Set(transitions.map((entry) => entry.sequence)).size !== transitions.length ||
    new Set(transitions.map((entry) => entry.transitionId)).size !== transitions.length ||
    new Set(value.controlCommands.map((entry) => entry.commandId)).size !==
      value.controlCommands.length
  ) {
    throw new Error('invalid_hive_runtime_relay_heartbeat_response')
  }
  return {
    responseVersion: value.responseVersion,
    ackedSessionTransitionSequence: value.ackedSessionTransitionSequence,
    sessionTransitionResults: structuredClone(transitions),
    sessionAuthorityUntil: expiry,
    ackedControlSequence: value.ackedControlSequence,
    controlCommands: structuredClone(value.controlCommands),
    nextControlSequence: value.nextControlSequence
  }
}
