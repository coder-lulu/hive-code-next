import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import {
  createRuntimeLeaseAcquireRequest,
  createRuntimeRegistrationLookupRequest,
  createRuntimeRegistrationRequest,
  type HiveRuntimeCloudReport
} from './hive-runtime-cloud-proof'
import {
  ClaimPendingPresenceError,
  FatalPresenceError,
  publicKeyDigest,
  reconcileRuntimeRegistrationState,
  ReconcilePresenceError,
  type ActiveLease,
  type PresenceClient
} from './hive-runtime-cloud-presence-support'
import type { HiveRuntimeCloudRegistrationState } from './hive-runtime-cloud-state-store'

type ActivationOptions = {
  client: PresenceClient
  authorization: HiveRuntimeCloudAuthorization
  identity: HiveRuntimeCloudIdentity
  stored: HiveRuntimeCloudRegistrationState | null
  bootId: string
  report: HiveRuntimeCloudReport
  signal: AbortSignal
  now: () => number
  randomUuid: () => string
  assertCurrent: () => void
  saveState: (state: HiveRuntimeCloudRegistrationState) => void
}

export type ActivationResult =
  | { status: 'CLAIM_PENDING' }
  | {
      status: 'LEASED'
      identity: HiveRuntimeCloudIdentity
      authorityId: string
      runtimeRecordId: string
      bootId: string
      lease: ActiveLease
    }

type ClaimedActivationOptions = Readonly<{
  client: PresenceClient
  identity: HiveRuntimeCloudIdentity
  stored: Extract<HiveRuntimeCloudRegistrationState, { status: 'CLAIMED' }>
  bootId: string
  signal: AbortSignal
  randomUuid: () => string
  assertCurrent: () => void
  saveState: (state: HiveRuntimeCloudRegistrationState) => void
}>

async function registerRuntime(
  options: ActivationOptions
): Promise<HiveRuntimeCloudRegistrationState> {
  let created: Awaited<ReturnType<PresenceClient['register']>>
  try {
    created = await options.client.register(
      createRuntimeRegistrationRequest(
        options.identity,
        {
          bootId: options.bootId,
          runtimeVersion: options.report.runtimeVersion,
          capabilities: options.report.capabilities
        },
        { authorityId: options.authorization.authorityId }
      ),
      options.randomUuid(),
      options.signal
    )
  } catch (error) {
    if (error instanceof HiveRuntimeCloudRequestError && error.status === 409) {
      throw new ReconcilePresenceError('registration_conflict')
    }
    throw error
  }
  options.assertCurrent()
  if (created.runtimeInstanceId !== options.identity.runtimeInstanceId) {
    throw new FatalPresenceError('registration_identity_mismatch')
  }
  return {
    schemaVersion: 1,
    runtimeRecordId: created.runtimeRecordId,
    status: 'PENDING_CLAIM',
    resourceVersion: created.resourceVersion,
    authorityGeneration: 1,
    fencingEpoch: 1,
    latestLeaseEpoch: 0,
    claimCapability: created.claimCapability,
    claimExpiresAt: created.claimExpiresAt
  }
}

async function claimRuntime(
  options: ActivationOptions,
  registration: Extract<HiveRuntimeCloudRegistrationState, { status: 'PENDING_CLAIM' }>
): Promise<Extract<HiveRuntimeCloudRegistrationState, { status: 'CLAIMED' }>> {
  let claim: Awaited<ReturnType<PresenceClient['claim']>>
  try {
    claim = await options.client.claim(
      {
        runtimeRecordId: registration.runtimeRecordId,
        claimCapability: registration.claimCapability,
        expectedVersion: registration.resourceVersion
      },
      options.authorization.accessToken,
      options.randomUuid(),
      options.signal
    )
  } catch (error) {
    if (
      error instanceof HiveRuntimeCloudRequestError &&
      (error.status === 403 || error.status === 410)
    ) {
      throw new ClaimPendingPresenceError('claim_authorization_required')
    }
    if (error instanceof HiveRuntimeCloudRequestError && error.status === 409) {
      throw new ReconcilePresenceError('claim_conflict')
    }
    throw error
  }
  options.assertCurrent()
  if (
    claim.runtime.runtimeRecordId !== registration.runtimeRecordId ||
    claim.runtime.runtimeInstanceId !== options.identity.runtimeInstanceId ||
    claim.runtime.ownerAccountId !== options.authorization.accountId
  ) {
    throw new FatalPresenceError('claim_identity_mismatch')
  }
  return {
    schemaVersion: 1,
    runtimeRecordId: claim.runtime.runtimeRecordId,
    status: 'CLAIMED',
    ownerAccountId: claim.runtime.ownerAccountId,
    authorityId: options.authorization.authorityId,
    resourceVersion: claim.runtime.resourceVersion,
    authorityGeneration: claim.runtime.authorityGeneration,
    fencingEpoch: claim.runtime.fencingEpoch,
    latestLeaseEpoch: registration.latestLeaseEpoch
  }
}

async function acquireRuntimeLease(
  options: ActivationOptions,
  registration: Extract<HiveRuntimeCloudRegistrationState, { status: 'CLAIMED' }>,
  bootId: string
): Promise<ActiveLease> {
  try {
    const lease = await options.client.acquireLease(
      createRuntimeLeaseAcquireRequest(
        options.identity,
        {
          bootId,
          expectedAuthorityGeneration: registration.authorityGeneration,
          expectedLeaseEpoch: registration.latestLeaseEpoch,
          expectedFencingEpoch: registration.fencingEpoch
        },
        { authorityId: options.authorization.authorityId }
      ),
      options.signal
    )
    options.assertCurrent()
    return { ...lease, bootId, nextHeartbeatSeq: 1 }
  } catch (error) {
    if (
      error instanceof HiveRuntimeCloudRequestError &&
      (error.status === 409 || error.status === 410)
    ) {
      throw new ReconcilePresenceError('lease_tuple_changed')
    }
    throw error
  }
}

export async function activateHiveRuntimeCloudPresence(
  options: ActivationOptions
): Promise<ActivationResult> {
  const lookup = await options.client.lookup(
    createRuntimeRegistrationLookupRequest(options.identity, {
      authorityId: options.authorization.authorityId
    }),
    options.signal
  )
  options.assertCurrent()

  let registration: HiveRuntimeCloudRegistrationState
  if (!lookup.exists) {
    registration = await registerRuntime(options)
  } else {
    if (lookup.identityPublicKeySha256 !== publicKeyDigest(options.identity)) {
      throw new FatalPresenceError('registration_identity_mismatch')
    }
    registration = reconcileRuntimeRegistrationState(lookup, options.stored)
  }
  options.saveState(registration)

  if (registration.status === 'PENDING_CLAIM') {
    if (registration.claimExpiresAt <= options.now()) {
      return { status: 'CLAIM_PENDING' }
    }
    registration = await claimRuntime(options, registration)
    // The mTLS activation token is deliberately not copied into state.
    options.saveState(registration)
  }

  if (registration.ownerAccountId !== options.authorization.accountId) {
    throw new FatalPresenceError('runtime_owner_mismatch')
  }
  const bootId = registration.latestLeaseEpoch > 0 ? options.randomUuid() : options.bootId
  const lease = await acquireRuntimeLease(options, registration, bootId)
  return {
    status: 'LEASED',
    identity: options.identity,
    authorityId: options.authorization.authorityId,
    runtimeRecordId: registration.runtimeRecordId,
    bootId,
    lease
  }
}

export async function activateClaimedHiveRuntimeCloudPresence(
  options: ClaimedActivationOptions
): Promise<Extract<ActivationResult, { status: 'LEASED' }>> {
  const authorityId = options.stored.authorityId
  if (!authorityId) {
    throw new ClaimPendingPresenceError('runtime_authority_unavailable')
  }
  const lookup = await options.client.lookup(
    createRuntimeRegistrationLookupRequest(options.identity, { authorityId }),
    options.signal
  )
  options.assertCurrent()
  if (!lookup.exists || lookup.status !== 'CLAIMED') {
    throw new ClaimPendingPresenceError('runtime_claim_required')
  }
  if (lookup.identityPublicKeySha256 !== publicKeyDigest(options.identity)) {
    throw new FatalPresenceError('registration_identity_mismatch')
  }
  const registration = reconcileRuntimeRegistrationState(lookup, options.stored)
  if (registration.status !== 'CLAIMED') {
    throw new ClaimPendingPresenceError('runtime_claim_required')
  }
  const claimed = { ...registration, authorityId }
  options.saveState(claimed)
  const bootId = claimed.latestLeaseEpoch > 0 ? options.randomUuid() : options.bootId
  const lease = await options.client.acquireLease(
    createRuntimeLeaseAcquireRequest(
      options.identity,
      {
        bootId,
        expectedAuthorityGeneration: claimed.authorityGeneration,
        expectedLeaseEpoch: claimed.latestLeaseEpoch,
        expectedFencingEpoch: claimed.fencingEpoch
      },
      { authorityId }
    ),
    options.signal
  )
  options.assertCurrent()
  return {
    status: 'LEASED',
    identity: options.identity,
    authorityId,
    runtimeRecordId: claimed.runtimeRecordId,
    bootId,
    lease: { ...lease, bootId, nextHeartbeatSeq: 1 }
  }
}
