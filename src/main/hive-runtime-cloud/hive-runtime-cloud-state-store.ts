import { join } from 'node:path'
import {
  deleteSecureJson,
  readSecureJson,
  writeSecureJson,
  type SecureReadResult
} from '../hive-account/hive-account-secure-store'

type RegistrationTuple = Readonly<{
  schemaVersion: 1
  runtimeRecordId: string
  resourceVersion: number
  authorityGeneration: number
  fencingEpoch: number
  latestLeaseEpoch: number
}>

export type HiveRuntimeCloudRegistrationState =
  | (RegistrationTuple & {
      status: 'PENDING_CLAIM'
      claimCapability: string
      claimExpiresAt: number
    })
  | (RegistrationTuple & {
      status: 'CLAIMED'
      ownerAccountId: string
    })

function statePath(userDataPath: string): string {
  return join(userDataPath, 'hive-runtime-cloud', 'registration-state.v1.enc')
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isState(value: unknown): value is HiveRuntimeCloudRegistrationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const candidate = value as Partial<HiveRuntimeCloudRegistrationState>
  const validTuple =
    candidate.schemaVersion === 1 &&
    typeof candidate.runtimeRecordId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      candidate.runtimeRecordId
    ) &&
    isPositiveInteger(candidate.resourceVersion) &&
    isPositiveInteger(candidate.authorityGeneration) &&
    isPositiveInteger(candidate.fencingEpoch) &&
    typeof candidate.latestLeaseEpoch === 'number' &&
    Number.isSafeInteger(candidate.latestLeaseEpoch) &&
    candidate.latestLeaseEpoch >= 0
  if (!validTuple) {
    return false
  }
  if (candidate.status === 'CLAIMED') {
    const expectedKeys = [
      'schemaVersion',
      'runtimeRecordId',
      'resourceVersion',
      'authorityGeneration',
      'fencingEpoch',
      'latestLeaseEpoch',
      'status',
      'ownerAccountId'
    ]
    return (
      Object.keys(candidate).length === expectedKeys.length &&
      expectedKeys.every((key) => key in candidate) &&
      typeof candidate.ownerAccountId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        candidate.ownerAccountId
      ) &&
      !('claimCapability' in candidate) &&
      !('claimExpiresAt' in candidate)
    )
  }
  const expectedKeys = [
    'schemaVersion',
    'runtimeRecordId',
    'resourceVersion',
    'authorityGeneration',
    'fencingEpoch',
    'latestLeaseEpoch',
    'status',
    'claimCapability',
    'claimExpiresAt'
  ]
  return (
    Object.keys(candidate).length === expectedKeys.length &&
    expectedKeys.every((key) => key in candidate) &&
    candidate.status === 'PENDING_CLAIM' &&
    typeof candidate.claimCapability === 'string' &&
    candidate.claimCapability.length >= 32 &&
    candidate.claimCapability.length <= 512 &&
    !/\s/.test(candidate.claimCapability) &&
    isPositiveInteger(candidate.claimExpiresAt)
  )
}

export function readHiveRuntimeCloudRegistrationState(
  userDataPath: string
): SecureReadResult<HiveRuntimeCloudRegistrationState> {
  return readSecureJson(statePath(userDataPath), isState)
}

export function saveHiveRuntimeCloudRegistrationState(
  userDataPath: string,
  state: HiveRuntimeCloudRegistrationState
): boolean {
  return isState(state) && writeSecureJson(statePath(userDataPath), state)
}

export function clearHiveRuntimeCloudRegistrationState(userDataPath: string): void {
  deleteSecureJson(statePath(userDataPath))
}
