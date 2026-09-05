import {
  HIVE_RELAY_HEARTBEAT_RESPONSE_FIELDS,
  normalizeHiveRuntimeRelayHeartbeatResponse
} from './relay-host/hive-runtime-relay-heartbeat-validation'
import type { HiveRuntimeRelayHeartbeatResponseControl } from './relay-host/hive-runtime-relay-heartbeat-types'

export type RuntimeRegistrationLookup =
  | { exists: false }
  | {
      exists: true
      runtimeRecordId: string
      status: 'PENDING_CLAIM' | 'CLAIMED'
      resourceVersion: number
      authorityGeneration: number
      fencingEpoch: number
      latestLeaseEpoch: number
      identityPublicKeySha256: string
    }

export type RuntimeRegistration = {
  runtimeRecordId: string
  runtimeInstanceId: string
  status: 'PENDING_CLAIM'
  claimCapability: string
  claimExpiresAt: number
  resourceVersion: number
}

export type RuntimeClaim = {
  runtime: {
    runtimeRecordId: string
    runtimeInstanceId: string
    ownerAccountId: string
    status: 'CLAIMED'
    authorityGeneration: number
    fencingEpoch: number
    resourceVersion: number
  }
  credentialActivationToken: string
  credentialActivationExpiresAt: number
}

export type RuntimeLease = {
  leaseId: string
  authorityGeneration: number
  leaseEpoch: number
  fencingEpoch: number
}

export type RuntimeHeartbeat = RuntimeLease &
  Partial<HiveRuntimeRelayHeartbeatResponseControl> & {
    acceptedHeartbeatSeq: number
    observedAt: number
    leaseExpiresAt: number
    presence: 'ONLINE' | 'STALE' | 'OFFLINE' | 'FENCED'
    duplicate: boolean
  }

export type RuntimeConnectionTicketConsume = Readonly<{
  managedWebSessionId: string
  runtimeSessionId: string
  status: 'ACTIVE'
  expiresAt: number
  controlVersion: number
}>

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function exactKeys(value: Record<string, unknown>, fields: readonly string[]): void {
  const keys = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 512) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  return value
}

export function uuid(value: unknown): string {
  const result = text(value)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  return result
}

export function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  return value
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  return value
}

function instant(value: unknown): number {
  const result = Date.parse(text(value))
  if (!Number.isFinite(result)) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  return result
}

export function problemCategory(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }
  return typeof value.category === 'string'
    ? value.category
    : typeof value.code === 'string'
      ? value.code
      : null
}

export function normalizeLookup(value: unknown): RuntimeRegistrationLookup {
  if (!isRecord(value) || typeof value.exists !== 'boolean') {
    throw new Error('invalid_hive_runtime_cloud_lookup_response')
  }
  if (!value.exists) {
    exactKeys(value, ['exists'])
    return { exists: false }
  }
  exactKeys(value, [
    'exists',
    'runtimeRecordId',
    'status',
    'resourceVersion',
    'authorityGeneration',
    'fencingEpoch',
    'latestLeaseEpoch',
    'identityPublicKeySha256'
  ])
  if (value.status !== 'PENDING_CLAIM' && value.status !== 'CLAIMED') {
    throw new Error('invalid_hive_runtime_cloud_lookup_response')
  }
  const digest = text(value.identityPublicKeySha256)
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error('invalid_hive_runtime_cloud_lookup_response')
  }
  return {
    exists: true,
    runtimeRecordId: uuid(value.runtimeRecordId),
    status: value.status,
    resourceVersion: positiveInteger(value.resourceVersion),
    authorityGeneration: positiveInteger(value.authorityGeneration),
    fencingEpoch: positiveInteger(value.fencingEpoch),
    latestLeaseEpoch: nonNegativeInteger(value.latestLeaseEpoch),
    identityPublicKeySha256: digest
  }
}

export function normalizeRegistration(value: unknown): RuntimeRegistration {
  if (!isRecord(value)) {
    throw new Error('invalid_hive_runtime_cloud_registration_response')
  }
  exactKeys(value, [
    'runtimeRecordId',
    'runtimeInstanceId',
    'status',
    'claimCapability',
    'claimExpiresAt',
    'resourceVersion'
  ])
  const claimCapability = text(value.claimCapability)
  if (
    value.status !== 'PENDING_CLAIM' ||
    claimCapability.length < 32 ||
    /\s/.test(claimCapability)
  ) {
    throw new Error('invalid_hive_runtime_cloud_registration_response')
  }
  return {
    runtimeRecordId: uuid(value.runtimeRecordId),
    runtimeInstanceId: uuid(value.runtimeInstanceId),
    status: 'PENDING_CLAIM',
    claimCapability,
    claimExpiresAt: instant(value.claimExpiresAt),
    resourceVersion: positiveInteger(value.resourceVersion)
  }
}

export function normalizeClaim(value: unknown): RuntimeClaim {
  if (!isRecord(value) || !isRecord(value.runtime)) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  exactKeys(value, ['runtime', 'credentialActivationToken', 'credentialActivationExpiresAt'])
  exactKeys(value.runtime, [
    'runtimeRecordId',
    'runtimeInstanceId',
    'ownerAccountId',
    'status',
    'authorityGeneration',
    'fencingEpoch',
    'resourceVersion'
  ])
  const activationToken = text(value.credentialActivationToken)
  if (
    value.runtime.status !== 'CLAIMED' ||
    activationToken.length < 32 ||
    /\s/.test(activationToken)
  ) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  return {
    runtime: {
      runtimeRecordId: uuid(value.runtime.runtimeRecordId),
      runtimeInstanceId: uuid(value.runtime.runtimeInstanceId),
      ownerAccountId: uuid(value.runtime.ownerAccountId),
      status: 'CLAIMED',
      authorityGeneration: positiveInteger(value.runtime.authorityGeneration),
      fencingEpoch: positiveInteger(value.runtime.fencingEpoch),
      resourceVersion: positiveInteger(value.runtime.resourceVersion)
    },
    credentialActivationToken: activationToken,
    credentialActivationExpiresAt: instant(value.credentialActivationExpiresAt)
  }
}

export function normalizeLease(value: unknown): RuntimeLease {
  if (!isRecord(value)) {
    throw new Error('invalid_hive_runtime_cloud_lease_response')
  }
  exactKeys(value, ['leaseId', 'authorityGeneration', 'leaseEpoch', 'fencingEpoch'])
  return {
    leaseId: uuid(value.leaseId),
    authorityGeneration: positiveInteger(value.authorityGeneration),
    leaseEpoch: positiveInteger(value.leaseEpoch),
    fencingEpoch: positiveInteger(value.fencingEpoch)
  }
}

export function normalizeHeartbeat(value: unknown): RuntimeHeartbeat {
  if (!isRecord(value)) {
    throw new Error('invalid_hive_runtime_cloud_heartbeat_response')
  }
  exactKeys(value, [
    'leaseId',
    'authorityGeneration',
    'leaseEpoch',
    'fencingEpoch',
    'acceptedHeartbeatSeq',
    'observedAt',
    'leaseExpiresAt',
    'presence',
    'duplicate',
    ...(Object.hasOwn(value, 'responseVersion') ? HIVE_RELAY_HEARTBEAT_RESPONSE_FIELDS : [])
  ])
  if (
    !['ONLINE', 'STALE', 'OFFLINE', 'FENCED'].includes(String(value.presence)) ||
    typeof value.duplicate !== 'boolean'
  ) {
    throw new Error('invalid_hive_runtime_cloud_heartbeat_response')
  }
  return {
    leaseId: uuid(value.leaseId),
    authorityGeneration: positiveInteger(value.authorityGeneration),
    leaseEpoch: positiveInteger(value.leaseEpoch),
    fencingEpoch: positiveInteger(value.fencingEpoch),
    acceptedHeartbeatSeq: nonNegativeInteger(value.acceptedHeartbeatSeq),
    observedAt: instant(value.observedAt),
    leaseExpiresAt: instant(value.leaseExpiresAt),
    presence: value.presence as RuntimeHeartbeat['presence'],
    duplicate: value.duplicate,
    ...(Object.hasOwn(value, 'responseVersion')
      ? normalizeHiveRuntimeRelayHeartbeatResponse(value, instant(value.observedAt))
      : {})
  }
}

export function normalizeConnectionTicketConsume(value: unknown): RuntimeConnectionTicketConsume {
  if (!isRecord(value)) {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  exactKeys(value, [
    'managedWebSessionId',
    'runtimeSessionId',
    'status',
    'expiresAt',
    'controlVersion'
  ])
  if (value.status !== 'ACTIVE') {
    throw new Error('invalid_hive_runtime_cloud_response')
  }
  return {
    managedWebSessionId: uuid(value.managedWebSessionId),
    runtimeSessionId: uuid(value.runtimeSessionId),
    status: 'ACTIVE',
    expiresAt: instant(value.expiresAt),
    controlVersion: positiveInteger(value.controlVersion)
  }
}
