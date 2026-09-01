import { exactKeys, isRecord, positiveInteger, uuid } from './hive-runtime-cloud-response'

export type RuntimeClaimCapabilityReissue = Readonly<{
  runtimeRecordId: string
  claimCapability: string
  claimExpiresAt: number
  resourceVersion: number
}>

export type RuntimeClaimReconcile = Readonly<{
  runtimeRecordId: string
  runtimeInstanceId: string
  status: 'CLAIMED'
  authorityGeneration: number
  fencingEpoch: number
  latestLeaseEpoch: number
  resourceVersion: number
  clientAuthMode: 'IDENTITY_PROOF'
}>

export type RuntimeClaimChallenge = Readonly<{
  challengeId: string
  userCode: string
  deviceCode: string
  verificationUri: string
  expiresAt: number
  pollIntervalSeconds: number
}>

export type RuntimeClaimChallengePoll =
  | Readonly<{ status: 'PENDING'; nextPollAt: number }>
  | Readonly<{ status: 'APPROVED'; runtime: RuntimeClaimReconcile }>
  | Readonly<{ status: 'EXPIRED' }>

function text(value: unknown, maximum = 512): string {
  if (typeof value !== 'string' || !value || value.length > maximum) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  return value
}

function instant(value: unknown): number {
  const parsed = Date.parse(text(value, 64))
  if (!Number.isFinite(parsed)) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  return parsed
}

export function normalizeClaimCapabilityReissue(value: unknown): RuntimeClaimCapabilityReissue {
  if (!isRecord(value)) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  exactKeys(value, ['runtimeRecordId', 'claimCapability', 'claimExpiresAt', 'resourceVersion'])
  const claimCapability = text(value.claimCapability)
  if (claimCapability.length < 32 || /\s/.test(claimCapability)) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  return {
    runtimeRecordId: uuid(value.runtimeRecordId),
    claimCapability,
    claimExpiresAt: instant(value.claimExpiresAt),
    resourceVersion: positiveInteger(value.resourceVersion)
  }
}

export function normalizeClaimReconcile(value: unknown): RuntimeClaimReconcile {
  if (!isRecord(value)) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  exactKeys(value, [
    'runtimeRecordId',
    'runtimeInstanceId',
    'status',
    'authorityGeneration',
    'fencingEpoch',
    'latestLeaseEpoch',
    'resourceVersion',
    'clientAuthMode'
  ])
  if (
    value.status !== 'CLAIMED' ||
    value.clientAuthMode !== 'IDENTITY_PROOF' ||
    typeof value.latestLeaseEpoch !== 'number' ||
    !Number.isSafeInteger(value.latestLeaseEpoch) ||
    value.latestLeaseEpoch < 0
  ) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  return {
    runtimeRecordId: uuid(value.runtimeRecordId),
    runtimeInstanceId: uuid(value.runtimeInstanceId),
    status: 'CLAIMED',
    authorityGeneration: positiveInteger(value.authorityGeneration),
    fencingEpoch: positiveInteger(value.fencingEpoch),
    latestLeaseEpoch: value.latestLeaseEpoch,
    resourceVersion: positiveInteger(value.resourceVersion),
    clientAuthMode: 'IDENTITY_PROOF'
  }
}

export function normalizeClaimChallenge(value: unknown): RuntimeClaimChallenge {
  if (!isRecord(value)) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  exactKeys(value, [
    'challengeId',
    'userCode',
    'deviceCode',
    'verificationUri',
    'expiresAt',
    'pollIntervalSeconds'
  ])
  const userCode = text(value.userCode, 32)
  const deviceCode = text(value.deviceCode)
  let verificationUri: URL
  try {
    verificationUri = new URL(text(value.verificationUri, 2048))
  } catch {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  if (
    !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(userCode) ||
    !/^[A-Za-z0-9_-]{43}$/.test(deviceCode) ||
    Buffer.from(deviceCode, 'base64url').toString('base64url') !== deviceCode ||
    Buffer.from(deviceCode, 'base64url').equals(Buffer.alloc(32)) ||
    verificationUri.protocol !== 'https:'
  ) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  return {
    challengeId: uuid(value.challengeId),
    userCode,
    deviceCode,
    verificationUri: verificationUri.toString(),
    expiresAt: instant(value.expiresAt),
    pollIntervalSeconds: positiveInteger(value.pollIntervalSeconds)
  }
}

export function normalizeClaimChallengePoll(value: unknown): RuntimeClaimChallengePoll {
  if (!isRecord(value)) {
    throw new Error('invalid_hive_runtime_cloud_claim_response')
  }
  if (value.status === 'PENDING') {
    exactKeys(value, ['status', 'nextPollAt'])
    return { status: 'PENDING', nextPollAt: instant(value.nextPollAt) }
  }
  if (value.status === 'APPROVED') {
    exactKeys(value, ['status', 'runtime'])
    return { status: 'APPROVED', runtime: normalizeClaimReconcile(value.runtime) }
  }
  if (value.status === 'EXPIRED') {
    exactKeys(value, ['status'])
    return { status: 'EXPIRED' }
  }
  throw new Error('invalid_hive_runtime_cloud_claim_response')
}
