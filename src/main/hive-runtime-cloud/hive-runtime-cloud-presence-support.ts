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

const MAXIMUM_LOCAL_RETRY_DELAY_MS = 30_000
const MAXIMUM_TIMER_DELAY_MS = 2_147_483_647

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

export function presenceRetryAfterDelay(error: unknown, random: () => number): number | undefined {
  if (
    !(error instanceof HiveRuntimeCloudRequestError) ||
    (error.status !== 429 && error.status !== 503) ||
    error.retryAfterMs === null ||
    !Number.isFinite(error.retryAfterMs) ||
    error.retryAfterMs < 0
  ) {
    return undefined
  }
  const jitterBound = Math.min(1_000, Math.max(100, error.retryAfterMs * 0.1))
  return Math.min(
    MAXIMUM_TIMER_DELAY_MS,
    error.retryAfterMs + Math.round(jitterBound * boundedRandom(random))
  )
}

export function schedulePresenceRetry(
  retryAttempt: number,
  random: () => number,
  canRun: () => boolean,
  action: () => void,
  error?: unknown
): NodeJS.Timeout {
  const boundedAttempt = Number.isFinite(retryAttempt)
    ? Math.min(30, Math.max(0, Math.floor(retryAttempt)))
    : 0
  const exponential = Math.min(MAXIMUM_LOCAL_RETRY_DELAY_MS, 1_000 * 2 ** boundedAttempt)
  const jitterBound = Math.min(3_000, Math.max(100, exponential * 0.1))
  const localDelay = exponential + Math.round(jitterBound * boundedRandom(random))
  const serverDelay = presenceRetryAfterDelay(error, random)
  const delay = Math.min(
    MAXIMUM_TIMER_DELAY_MS,
    serverDelay === undefined ? localDelay : Math.max(serverDelay, localDelay)
  )
  const timer = setTimeout(() => {
    if (canRun()) {
      action()
    }
  }, delay)
  timer.unref?.()
  return timer
}

function boundedRandom(random: () => number): number {
  const value = random()
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
}

export function reconcileRuntimeRegistrationState(
  lookup: Extract<RuntimeRegistrationLookup, { exists: true }>,
  stored: HiveRuntimeCloudRegistrationState | null
): HiveRuntimeCloudRegistrationState {
  if (lookup.status === 'UNLINKED') {
    throw new ClaimPendingPresenceError('runtime_claim_required')
  }
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
