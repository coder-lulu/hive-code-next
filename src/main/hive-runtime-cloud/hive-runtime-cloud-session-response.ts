import type { HiveRuntimeSession, HiveRuntimeSessionStatus } from '../../shared/hive-runtime-cloud'
import { exactKeys, isRecord, positiveInteger, uuid } from './hive-runtime-cloud-response'

const SESSION_KEYS = [
  'managedWebSessionId',
  'runtimeRecordId',
  'runtimeInstanceId',
  'runtimeSessionId',
  'clientKind',
  'clientLabel',
  'status',
  'resourceVersion',
  'controlVersion',
  'createdAt',
  'expiresAt',
  'revokeRequestedAt',
  'revokeAcknowledgedAt'
] as const

const SESSION_STATUSES = new Set<HiveRuntimeSessionStatus>([
  'ACTIVE',
  'REVOKE_PENDING',
  'REVOKED',
  'EXPIRED',
  'UNVERIFIABLE'
])

function invalid(): never {
  throw new Error('invalid_hive_runtime_cloud_session_response')
}

function instant(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return invalid()
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : invalid()
}

function optionalInstant(value: unknown): number | null {
  return value === null ? null : instant(value)
}

function clientLabel(value: unknown): string | null {
  if (value === null) {
    return null
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 || (code >= 127 && code <= 159)
    })
  ) {
    return invalid()
  }
  return value
}

function normalizeStatus(value: unknown): HiveRuntimeSessionStatus {
  return SESSION_STATUSES.has(value as HiveRuntimeSessionStatus)
    ? (value as HiveRuntimeSessionStatus)
    : invalid()
}

export function normalizeRuntimeSession(value: unknown): HiveRuntimeSession {
  if (!isRecord(value)) {
    return invalid()
  }
  exactKeys(value, SESSION_KEYS)
  if (
    value.clientKind !== 'WEB' &&
    value.clientKind !== 'DESKTOP' &&
    value.clientKind !== 'MOBILE'
  ) {
    return invalid()
  }
  const createdAt = instant(value.createdAt)
  const expiresAt = instant(value.expiresAt)
  if (expiresAt <= createdAt) {
    return invalid()
  }
  return {
    managedWebSessionId: uuid(value.managedWebSessionId),
    runtimeRecordId: uuid(value.runtimeRecordId),
    runtimeInstanceId: uuid(value.runtimeInstanceId),
    runtimeSessionId: uuid(value.runtimeSessionId),
    clientKind: value.clientKind,
    clientLabel: clientLabel(value.clientLabel),
    status: normalizeStatus(value.status),
    resourceVersion: positiveInteger(value.resourceVersion),
    controlVersion: positiveInteger(value.controlVersion),
    createdAt,
    expiresAt,
    revokeRequestedAt: optionalInstant(value.revokeRequestedAt),
    revokeAcknowledgedAt: optionalInstant(value.revokeAcknowledgedAt)
  }
}

export function normalizeRuntimeSessionPage(value: unknown): Readonly<{
  items: readonly HiveRuntimeSession[]
  nextCursor: string | null
}> {
  if (!isRecord(value)) {
    return invalid()
  }
  exactKeys(value, ['items', 'nextCursor'])
  if (!Array.isArray(value.items) || value.items.length > 100) {
    return invalid()
  }
  const nextCursor = value.nextCursor
  if (
    nextCursor !== null &&
    (typeof nextCursor !== 'string' ||
      nextCursor.length === 0 ||
      nextCursor.length > 256 ||
      /\s|=/.test(nextCursor))
  ) {
    return invalid()
  }
  return { items: value.items.map(normalizeRuntimeSession), nextCursor }
}
