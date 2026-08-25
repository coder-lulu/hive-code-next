import { createHash, randomUUID } from 'node:crypto'
import {
  HiveRuntimeCloudClient,
  HiveRuntimeCloudRequestError,
  HiveRuntimeCloudTransportError,
  type RuntimeLease,
  type RuntimeRegistrationLookup
} from './hive-runtime-cloud-client'
import {
  getOrCreateHiveRuntimeCloudIdentity,
  type HiveRuntimeCloudIdentity
} from './hive-runtime-cloud-identity-store'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'
import {
  readHiveRuntimeCloudRegistrationState,
  saveHiveRuntimeCloudRegistrationState,
  type HiveRuntimeCloudRegistrationState
} from './hive-runtime-cloud-state-store'

export type HiveRuntimeCloudPresenceState =
  | 'DISABLED'
  | 'SIGNED_OUT'
  | 'WAITING_RUNTIME'
  | 'ACTIVATING'
  | 'CLAIM_PENDING'
  | 'LEASED'
  | 'ONLINE'
  | 'OFFLINE_RETRY'
  | 'FENCED'
  | 'STOPPED'

export type PresenceClient = Pick<
  HiveRuntimeCloudClient,
  'lookup' | 'register' | 'claim' | 'acquireLease' | 'heartbeat'
>

export type RuntimeSource = {
  getReport: () => HiveRuntimeCloudReport
}

export type PresenceDependencies = {
  createClient: (apiBaseUrl: string) => PresenceClient
  loadIdentity: (userDataPath: string) => ReturnType<typeof getOrCreateHiveRuntimeCloudIdentity>
  readState: (userDataPath: string) => ReturnType<typeof readHiveRuntimeCloudRegistrationState>
  saveState: (userDataPath: string, state: HiveRuntimeCloudRegistrationState) => boolean
  randomUuid: () => string
  now: () => number
  random: () => number
}

export const defaultPresenceDependencies: PresenceDependencies = {
  createClient: (apiBaseUrl) => new HiveRuntimeCloudClient(apiBaseUrl),
  loadIdentity: getOrCreateHiveRuntimeCloudIdentity,
  readState: readHiveRuntimeCloudRegistrationState,
  saveState: saveHiveRuntimeCloudRegistrationState,
  randomUuid: randomUUID,
  now: Date.now,
  random: Math.random
}

export type ActiveLease = RuntimeLease & {
  bootId: string
  nextHeartbeatSeq: number
}

export class FatalPresenceError extends Error {}
export class ClaimPendingPresenceError extends Error {}
export class ReconcilePresenceError extends Error {}

export function publicKeyDigest(identity: HiveRuntimeCloudIdentity): string {
  return createHash('sha256').update(Buffer.from(identity.publicKey, 'base64url')).digest('hex')
}

export function isRetryablePresenceError(error: unknown): boolean {
  return (
    error instanceof ReconcilePresenceError ||
    error instanceof HiveRuntimeCloudTransportError ||
    (error instanceof HiveRuntimeCloudRequestError &&
      (error.status === 429 || error.status === 503))
  )
}

export function schedulePresenceRetry(
  retryAttempt: number,
  random: () => number,
  canRun: () => boolean,
  action: () => void,
  explicitDelay?: number
): NodeJS.Timeout {
  const exponential = Math.min(30_000, 1_000 * 2 ** retryAttempt)
  const delay = explicitDelay ?? Math.round(exponential * (0.5 + random()))
  const timer = setTimeout(() => {
    if (canRun()) {
      action()
    }
  }, delay)
  timer.unref?.()
  return timer
}

export function reconcileRuntimeRegistrationState(
  lookup: Extract<RuntimeRegistrationLookup, { exists: true }>,
  stored: HiveRuntimeCloudRegistrationState | null
): HiveRuntimeCloudRegistrationState {
  if (lookup.status === 'PENDING_CLAIM') {
    if (stored?.status !== 'PENDING_CLAIM' || stored.runtimeRecordId !== lookup.runtimeRecordId) {
      throw new ClaimPendingPresenceError('claim_capability_unavailable')
    }
  } else if (stored?.status !== 'CLAIMED' || stored.runtimeRecordId !== lookup.runtimeRecordId) {
    throw new FatalPresenceError('runtime_owner_unavailable')
  }
  return {
    ...stored,
    resourceVersion: lookup.resourceVersion,
    authorityGeneration: lookup.authorityGeneration,
    fencingEpoch: lookup.fencingEpoch,
    latestLeaseEpoch: lookup.latestLeaseEpoch
  }
}
