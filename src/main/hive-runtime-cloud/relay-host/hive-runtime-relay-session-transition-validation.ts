import { createHash } from 'node:crypto'
import type {
  HiveRuntimeRelaySessionTransition,
  HiveRuntimeRelayTransitionAdjudication,
  HiveRuntimeRelayTransitionState
} from './hive-runtime-relay-session-transition-types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const FIELDS = [
  'sequence',
  'transitionId',
  'transitionType',
  'managedSessionId',
  'runtimeSessionId',
  'expectedControlVersion',
  'sessionBindingHash',
  'occurredAt',
  'reason'
] as const
const REASONS: Record<string, readonly string[]> = {
  ACTIVATE: ['ACTIVATED'],
  ABANDON: ['ABANDONED_BEFORE_ACTIVATION'],
  CLOSE: ['CLIENT_CLOSED', 'RUNTIME_SHUTDOWN', 'TRANSPORT_CLOSED', 'LOCAL_ERROR'],
  IDLE_EXPIRE: ['IDLE_TIMEOUT'],
  AUTHORITY_EXPIRE: ['SESSION_AUTHORITY_TIMEOUT']
}
const STORED_VERDICTS = [
  'APPLIED',
  'REJECTED_NOT_FOUND',
  'REJECTED_BINDING',
  'REJECTED_STALE_VERSION',
  'REJECTED_ILLEGAL_STATE',
  'REJECTED_DEADLINE',
  'REJECTED_AUTHORITY'
]
const STATUSES = [
  'PENDING_ACTIVATION',
  'ACTIVE',
  'CLOSED',
  'EXPIRED',
  'UNVERIFIABLE',
  'REVOKE_PENDING',
  'REVOKED'
]

export function transitionInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
export function transitionObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
export function validTransitionIdentity(runtimeId: string, runtimeBootId: string): boolean {
  return (
    typeof runtimeId === 'string' &&
    typeof runtimeBootId === 'string' &&
    OPAQUE.test(runtimeId) &&
    UUID.test(runtimeBootId)
  )
}
export function isHiveRuntimeRelaySessionTransition(
  value: unknown
): value is HiveRuntimeRelaySessionTransition {
  if (!transitionObject(value) || !exact(value, FIELDS)) {
    return false
  }
  return (
    transitionInteger(value.sequence) &&
    value.sequence > 0 &&
    typeof value.transitionId === 'string' &&
    UUID.test(value.transitionId) &&
    typeof value.transitionType === 'string' &&
    Object.hasOwn(REASONS, value.transitionType) &&
    typeof value.reason === 'string' &&
    REASONS[value.transitionType].includes(value.reason) &&
    typeof value.managedSessionId === 'string' &&
    OPAQUE.test(value.managedSessionId) &&
    typeof value.runtimeSessionId === 'string' &&
    OPAQUE.test(value.runtimeSessionId) &&
    transitionInteger(value.expectedControlVersion) &&
    transitionInteger(value.occurredAt) &&
    typeof value.sessionBindingHash === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value.sessionBindingHash) &&
    Buffer.from(value.sessionBindingHash, 'base64url').toString('base64url') ===
      value.sessionBindingHash
  )
}
export function isHiveRuntimeRelayTransitionAdjudication(
  value: unknown
): value is HiveRuntimeRelayTransitionAdjudication {
  if (
    !transitionObject(value) ||
    !exact(value, [
      'sequence',
      'transitionId',
      'verdict',
      'stored',
      'resultingStatus',
      'resultingControlVersion'
    ])
  ) {
    return false
  }
  return (
    transitionInteger(value.sequence) &&
    value.sequence > 0 &&
    typeof value.transitionId === 'string' &&
    UUID.test(value.transitionId) &&
    typeof value.verdict === 'string' &&
    (STORED_VERDICTS.includes(value.verdict)
      ? value.stored === true
      : ['TRANSITION_REPLAY_CONFLICT', 'SEQUENCE_GAP'].includes(value.verdict) &&
        value.stored === false) &&
    typeof value.resultingStatus === 'string' &&
    STATUSES.includes(value.resultingStatus) &&
    transitionInteger(value.resultingControlVersion)
  )
}

export function hiveRuntimeRelayTransitionDigest(
  transition: HiveRuntimeRelaySessionTransition
): string {
  const hash = createHash('sha256')
  for (const key of FIELDS) {
    const name = Buffer.from(key)
    const field = transition[key]
    let value: Buffer
    if (typeof field === 'number') {
      value = Buffer.alloc(8)
      value.writeBigUInt64BE(BigInt(field))
    } else {
      value = Buffer.from(field)
    }
    const length = Buffer.alloc(4)
    length.writeUInt32BE(name.length)
    hash.update(length).update(name)
    length.writeUInt32BE(value.length)
    hash.update(length).update(value)
  }
  return hash.digest('hex')
}

export function isHiveRuntimeRelayTransitionState(
  value: unknown
): value is HiveRuntimeRelayTransitionState {
  if (
    !transitionObject(value) ||
    !exact(value, [
      'version',
      'runtimeId',
      'runtimeBootId',
      'nextSequence',
      'highestAck',
      'entries'
    ]) ||
    value.version !== 'hiverelay-session-transition-outbox/v1' ||
    typeof value.runtimeId !== 'string' ||
    typeof value.runtimeBootId !== 'string' ||
    !validTransitionIdentity(value.runtimeId, value.runtimeBootId) ||
    !transitionInteger(value.nextSequence) ||
    value.nextSequence < 1 ||
    !transitionInteger(value.highestAck) ||
    value.highestAck >= value.nextSequence ||
    !Array.isArray(value.entries) ||
    value.entries.length > 1024 ||
    value.entries.length >= value.nextSequence
  ) {
    return false
  }
  const first = value.nextSequence - value.entries.length
  if (value.highestAck < first - 1) {
    return false
  }
  const ids = new Set<string>()
  return value.entries.every((entry, index) => {
    if (
      !transitionObject(entry) ||
      !exact(
        entry,
        Object.hasOwn(entry, 'result')
          ? ['transition', 'payloadSha256', 'result']
          : ['transition', 'payloadSha256']
      ) ||
      !isHiveRuntimeRelaySessionTransition(entry.transition) ||
      entry.transition.sequence !== first + index ||
      entry.payloadSha256 !== hiveRuntimeRelayTransitionDigest(entry.transition) ||
      ids.has(entry.transition.transitionId)
    ) {
      return false
    }
    ids.add(entry.transition.transitionId)
    return (
      !Object.hasOwn(entry, 'result') ||
      (isHiveRuntimeRelayTransitionAdjudication(entry.result) &&
        entry.result.stored &&
        entry.result.sequence === entry.transition.sequence &&
        entry.result.transitionId === entry.transition.transitionId)
    )
  })
}
