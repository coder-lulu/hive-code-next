import { randomUUID } from 'node:crypto'
import type { HiveLocalRuntimeCloudStatus } from '../../shared/hive-runtime-cloud'
import { HiveRuntimeCloudClient } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudConfig } from './hive-runtime-cloud-config'
import {
  clearHiveRuntimeCloudIdentity,
  getOrCreateHiveRuntimeCloudIdentity
} from './hive-runtime-cloud-identity-store'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'
import type { CurrentHiveRuntimeCloudLeaseContext } from './hive-runtime-cloud-lease-context'
import {
  clearHiveRuntimeCloudRegistrationState,
  readHiveRuntimeCloudRegistrationState,
  saveHiveRuntimeCloudRegistrationState,
  type HiveRuntimeCloudRegistrationState
} from './hive-runtime-cloud-state-store'

export type OwnershipClient = Pick<
  HiveRuntimeCloudClient,
  | 'getAuthorityId'
  | 'lookup'
  | 'register'
  | 'getOwnedRuntime'
  | 'reissueClaimCapability'
  | 'reconcileClaim'
  | 'createClaimChallenge'
  | 'pollClaimChallenge'
>

export type LocalRuntimeOwnershipDependencies = Readonly<{
  createClient: (apiBaseUrl: string) => OwnershipClient
  loadIdentity: (userDataPath: string) => ReturnType<typeof getOrCreateHiveRuntimeCloudIdentity>
  readState: (userDataPath: string) => ReturnType<typeof readHiveRuntimeCloudRegistrationState>
  saveState: (userDataPath: string, state: HiveRuntimeCloudRegistrationState) => boolean
  clearIdentity: (userDataPath: string) => void
  clearState: (userDataPath: string) => void
  randomUuid: () => string
  now: () => number
  waitForClaimPoll?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}>

export const defaultLocalRuntimeOwnershipDependencies: LocalRuntimeOwnershipDependencies = {
  createClient: (apiBaseUrl) => new HiveRuntimeCloudClient(apiBaseUrl),
  loadIdentity: getOrCreateHiveRuntimeCloudIdentity,
  readState: readHiveRuntimeCloudRegistrationState,
  saveState: saveHiveRuntimeCloudRegistrationState,
  clearIdentity: clearHiveRuntimeCloudIdentity,
  clearState: clearHiveRuntimeCloudRegistrationState,
  randomUuid: randomUUID,
  now: Date.now
}

export type LocalRuntimeOwnershipServiceOptions = Readonly<{
  config: HiveRuntimeCloudConfig
  userDataPath: string
  getReport: () => HiveRuntimeCloudReport
  getBootId: () => string
  getCurrentLeaseContext: () => CurrentHiveRuntimeCloudLeaseContext | null
  getRelayStatus?: () => HiveLocalRuntimeCloudStatus['relay']
  onRegistrationChanged?: () => void
  dependencies?: LocalRuntimeOwnershipDependencies
}>

export type HeadlessClaim = Readonly<{
  challengeId: string
  deviceCode: string
  runtimeRecordId: string
  runtimeInstanceId: string
  authorityId: string
  expiresAt: number
}>
