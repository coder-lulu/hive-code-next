import { join } from 'node:path'
import {
  deleteSecureJson,
  readSecureJson,
  writeSecureJson,
  type SecureReadResult
} from '../hive-account/hive-account-secure-store'
import {
  deleteHiveRuntimeServiceOwnedJson,
  readHiveRuntimeServiceOwnedJson,
  writeHiveRuntimeServiceOwnedJson
} from './hive-runtime-cloud-service-owned-json'

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
      authorityId?: string
    })
  | (RegistrationTuple & {
      status: 'CLAIMED'
      ownerAccountId?: string
      authorityId?: string
    })

function statePath(userDataPath: string): string {
  return join(userDataPath, 'hive-runtime-cloud', 'registration-state.v1.enc')
}

function serviceStatePath(userDataPath: string): string {
  return join(userDataPath, 'hive-runtime-cloud-service', 'registration-state.v1.json')
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function containsAsciiControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
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
    const requiredKeys = [
      'schemaVersion',
      'runtimeRecordId',
      'resourceVersion',
      'authorityGeneration',
      'fencingEpoch',
      'latestLeaseEpoch',
      'status'
    ]
    const keys = Object.keys(candidate)
    const allowedKeys = [...requiredKeys, 'ownerAccountId', 'authorityId']
    return (
      keys.length >= requiredKeys.length &&
      keys.length <= allowedKeys.length &&
      requiredKeys.every((key) => key in candidate) &&
      keys.every((key) => allowedKeys.includes(key)) &&
      (candidate.ownerAccountId === undefined ||
        (typeof candidate.ownerAccountId === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            candidate.ownerAccountId
          ))) &&
      (candidate.authorityId === undefined ||
        (typeof candidate.authorityId === 'string' &&
          candidate.authorityId.length > 0 &&
          candidate.authorityId.length <= 128 &&
          !containsAsciiControl(candidate.authorityId))) &&
      !('claimCapability' in candidate) &&
      !('claimExpiresAt' in candidate)
    )
  }
  const requiredKeys = [
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
  const keys = Object.keys(candidate)
  const allowedKeys = [...requiredKeys, 'authorityId']
  return (
    keys.length >= requiredKeys.length &&
    keys.length <= allowedKeys.length &&
    requiredKeys.every((key) => key in candidate) &&
    keys.every((key) => allowedKeys.includes(key)) &&
    candidate.status === 'PENDING_CLAIM' &&
    typeof candidate.claimCapability === 'string' &&
    candidate.claimCapability.length >= 32 &&
    candidate.claimCapability.length <= 512 &&
    !/\s/.test(candidate.claimCapability) &&
    isPositiveInteger(candidate.claimExpiresAt) &&
    (candidate.authorityId === undefined ||
      (typeof candidate.authorityId === 'string' &&
        candidate.authorityId.length > 0 &&
        candidate.authorityId.length <= 128 &&
        !containsAsciiControl(candidate.authorityId)))
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

export function readHiveRuntimeCloudServiceRegistrationState(
  userDataPath: string
): SecureReadResult<HiveRuntimeCloudRegistrationState> {
  return readHiveRuntimeServiceOwnedJson(serviceStatePath(userDataPath), isState)
}

export function saveHiveRuntimeCloudServiceRegistrationState(
  userDataPath: string,
  state: HiveRuntimeCloudRegistrationState
): boolean {
  return isState(state) && writeHiveRuntimeServiceOwnedJson(serviceStatePath(userDataPath), state)
}

export function clearHiveRuntimeCloudServiceRegistrationState(userDataPath: string): void {
  deleteHiveRuntimeServiceOwnedJson(serviceStatePath(userDataPath))
}
