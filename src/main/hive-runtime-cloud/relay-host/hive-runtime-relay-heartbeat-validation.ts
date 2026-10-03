import {
  isHiveRuntimeRelaySessionTransition,
  isHiveRuntimeRelayTransitionAdjudication,
  transitionInteger,
  transitionObject
} from './hive-runtime-relay-session-transition-validation'
import type {
  HiveRuntimeRelayHeartbeatCommand,
  HiveRuntimeRelayHeartbeatControl,
  HiveRuntimeRelayHeartbeatResponseControl,
  HiveRuntimeRelayRegionMeasurement,
  HiveRuntimeRelayRegionMeasurementWindow
} from './hive-runtime-relay-heartbeat-types'

export const HIVE_RELAY_HEARTBEAT_RESPONSE_FIELDS = [
  'responseVersion',
  'ackedSessionTransitionSequence',
  'sessionTransitionResults',
  'sessionAuthorityUntil',
  'regionMeasurementWindow',
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
function region(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)
}
function probeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512) {
    return false
  }
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    )
  } catch {
    return false
  }
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
      'assignmentEpoch',
      'targetResourceVersion',
      'targetControlVersion',
      'reason',
      'targetRegion'
    ]) &&
    positive(value.sequence) &&
    uuid(value.commandId) &&
    uuid(value.assignmentId) &&
    positive(value.targetResourceVersion) &&
    ((value.commandType === 'SESSION_REVOKE' &&
      uuid(value.managedSessionId) &&
      value.assignmentEpoch === null &&
      positive(value.targetControlVersion) &&
      typeof value.reason === 'string' &&
      [
        'ACCOUNT_SESSION_REVOKED',
        'ACCOUNT_DEVICE_REVOKED',
        'ACCOUNT_DELETION',
        'RUNTIME_AUTHORITY_REVOKED',
        'RUNTIME_CREDENTIAL_REVOKED',
        'ADMINISTRATIVE'
      ].includes(value.reason) &&
      value.targetRegion === null) ||
      (value.commandType === 'RELAY_REHOME' &&
        value.managedSessionId === null &&
        transitionInteger(value.assignmentEpoch) &&
        value.targetControlVersion === null &&
        value.reason === null &&
        region(value.targetRegion)))
  )
}
function regionMeasurement(value: unknown): value is HiveRuntimeRelayRegionMeasurement {
  if (
    !transitionObject(value) ||
    !exact(value, [
      'policyVersion',
      'windowGeneration',
      'assignmentId',
      'assignmentEpoch',
      'incumbentRegion',
      'outcome',
      'measurements',
      'failure'
    ]) ||
    value.policyVersion !== 1 ||
    !positive(value.windowGeneration) ||
    !uuid(value.assignmentId) ||
    !transitionInteger(value.assignmentEpoch) ||
    !region(value.incumbentRegion) ||
    !Array.isArray(value.measurements) ||
    value.measurements.length > 8 ||
    !value.measurements.every(
      (measurement) =>
        transitionObject(measurement) &&
        exact(measurement, ['region', 'latencyMillis']) &&
        region(measurement.region) &&
        positive(measurement.latencyMillis) &&
        measurement.latencyMillis <= 60_000
    ) ||
    new Set(value.measurements.map((measurement) => measurement.region)).size !==
      value.measurements.length
  ) {
    return false
  }
  return value.outcome === 'CONCLUSIVE'
    ? value.measurements.length >= 2 && value.failure === null
    : value.outcome === 'INCONCLUSIVE' &&
        value.measurements.length === 0 &&
        ['TIMEOUT', 'NETWORK_ERROR', 'INCOMPLETE'].some((failure) => failure === value.failure)
}
function normalizeWindow(
  value: unknown,
  observedAt: number
): HiveRuntimeRelayRegionMeasurementWindow | null | undefined {
  if (value === null) {
    return null
  }
  if (
    !transitionObject(value) ||
    !exact(value, [
      'policyVersion',
      'generation',
      'expiresAt',
      'assignmentId',
      'assignmentEpoch',
      'incumbentRegion',
      'candidates'
    ]) ||
    value.policyVersion !== 1 ||
    !positive(value.generation) ||
    !uuid(value.assignmentId) ||
    !transitionInteger(value.assignmentEpoch) ||
    !region(value.incumbentRegion) ||
    typeof value.expiresAt !== 'string' ||
    !Array.isArray(value.candidates) ||
    value.candidates.length < 2 ||
    value.candidates.length > 8 ||
    !value.candidates.every(
      (candidate) =>
        transitionObject(candidate) &&
        exact(candidate, ['region', 'probeUrl']) &&
        region(candidate.region) &&
        probeUrl(candidate.probeUrl)
    ) ||
    new Set(value.candidates.map((candidate) => candidate.region)).size !==
      value.candidates.length ||
    !value.candidates.some((candidate) => candidate.region === value.incumbentRegion)
  ) {
    return undefined
  }
  const expiresAt = Date.parse(value.expiresAt)
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= observedAt ||
    expiresAt > observedAt + 130_000
  ) {
    return undefined
  }
  return {
    policyVersion: 1,
    generation: value.generation,
    expiresAt,
    assignmentId: value.assignmentId,
    assignmentEpoch: value.assignmentEpoch,
    incumbentRegion: value.incumbentRegion,
    candidates: structuredClone(value.candidates)
  }
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
      'sessionTransitions',
      'activeConnectionCount',
      'regionSelectionMode',
      'regionMeasurement'
    ])
  ) {
    return false
  }
  const ack = value.controlCommandAck
  const measurement = value.regionMeasurement
  return (
    uuid(value.assignmentId) &&
    uuid(value.cellIncarnationId) &&
    typeof value.cellId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.cellId) &&
    transitionInteger(value.assignmentEpoch) &&
    transitionInteger(value.controlGeneration) &&
    typeof value.controlConnectionAcknowledged === 'boolean' &&
    transitionInteger(value.activeConnectionCount) &&
    value.activeConnectionCount <= 32 &&
    (value.regionSelectionMode === 'DYNAMIC' || value.regionSelectionMode === 'ADMIN_OVERRIDE') &&
    (measurement === null || regionMeasurement(measurement)) &&
    !(value.regionSelectionMode === 'ADMIN_OVERRIDE' && measurement !== null) &&
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
  const window = normalizeWindow(value.regionMeasurementWindow, observedAt)
  if (
    value.responseVersion !== 'runtime-session-control/v1' ||
    window === undefined ||
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
    regionMeasurementWindow: window,
    ackedControlSequence: value.ackedControlSequence,
    controlCommands: structuredClone(value.controlCommands),
    nextControlSequence: value.nextControlSequence
  }
}
