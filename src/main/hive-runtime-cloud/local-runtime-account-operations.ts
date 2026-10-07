import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveLocalRuntimeOwnershipState } from '../../shared/hive-runtime-cloud'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import {
  createRuntimeClaimChallengeRequest,
  createRuntimeClaimReconcileRequest
} from './hive-runtime-cloud-proof'
import { sameRegistrationTuple } from './local-runtime-registration'
import type { ClaimedRegistration, LocalRuntimeRegistration } from './local-runtime-registration'

export type OwnershipAnalysis = Readonly<{
  result: Pick<
    HiveLocalRuntimeOwnershipState,
    'relation' | 'runtimeRecordId' | 'claimCapabilityAvailable' | 'errorCode'
  >
  registrationChanged: boolean
}>

type AccountOperation = Readonly<{
  registration: LocalRuntimeRegistration
  authorization: HiveRuntimeCloudAuthorization
  signal: AbortSignal
  assertCurrent: () => void
}>

export async function analyzeLocalRuntimeOwnership({
  registration,
  authorization,
  signal,
  assertCurrent
}: AccountOperation): Promise<OwnershipAnalysis> {
  const identity = registration.requireIdentity()
  await registration.requireAccountAuthority(authorization, signal)
  assertCurrent()
  const lookup = await registration.lookup(identity, authorization.authorityId, signal)
  assertCurrent()
  const stored = registration.readState()
  if (!lookup.exists || lookup.status === 'UNLINKED') {
    const registrationChanged = lookup.exists && stored !== null
    if (registrationChanged) {
      registration.clearRegistration()
    }
    return {
      result: ownershipResult('UNREGISTERED', lookup.exists ? lookup.runtimeRecordId : null),
      registrationChanged
    }
  }
  if (lookup.status === 'PENDING_CLAIM') {
    const pending =
      stored?.status === 'PENDING_CLAIM' &&
      stored.runtimeRecordId === lookup.runtimeRecordId &&
      (!stored.authorityId || stored.authorityId === authorization.authorityId)
        ? stored
        : null
    return {
      result: {
        ...ownershipResult('PENDING_CLAIM', lookup.runtimeRecordId),
        claimCapabilityAvailable: Boolean(pending && pending.claimExpiresAt > registration.now()),
        errorCode: pending ? null : 'CLAIM_CAPABILITY_UNAVAILABLE'
      },
      registrationChanged: false
    }
  }
  try {
    await registration.requireCurrentAccountOwnership(lookup.runtimeRecordId, authorization, signal)
  } catch (error) {
    if (error instanceof HiveRuntimeCloudRequestError && error.status === 404) {
      return {
        result: {
          ...ownershipResult('CLAIMED_BY_OTHER', lookup.runtimeRecordId),
          errorCode: 'CLAIMED_BY_OTHER'
        },
        registrationChanged: false
      }
    }
    throw error
  }
  assertCurrent()
  const claimed = {
    ...registration.claimedFromLookup(lookup, authorization.authorityId),
    ownerAccountId: authorization.accountId
  }
  const registrationChanged = !sameRegistrationTuple(stored, claimed)
  if (
    registrationChanged ||
    stored?.status !== 'CLAIMED' ||
    stored.ownerAccountId !== authorization.accountId
  ) {
    registration.persist(claimed)
  }
  return {
    result: ownershipResult('CLAIMED_BY_CURRENT', lookup.runtimeRecordId),
    registrationChanged
  }
}

export async function claimLocalRuntimeForAccount({
  registration,
  authorization,
  signal,
  assertCurrent,
  openVerification,
  waitForPoll
}: AccountOperation & {
  openVerification: (userCode: string) => Promise<void>
  waitForPoll: (milliseconds: number, signal: AbortSignal) => Promise<void>
}): Promise<ClaimedRegistration> {
  const identity = registration.requireIdentity()
  await registration.requireAccountAuthority(authorization, signal)
  assertCurrent()
  const lookup = await registration.lookup(identity, authorization.authorityId, signal)
  assertCurrent()
  if (lookup.exists && lookup.status === 'CLAIMED') {
    await registration.requireCurrentAccountOwnership(lookup.runtimeRecordId, authorization, signal)
    assertCurrent()
    const reconciled = await registration
      .requireClient()
      .reconcileClaim(
        lookup.runtimeRecordId,
        createRuntimeClaimReconcileRequest(
          identity,
          { runtimeRecordId: lookup.runtimeRecordId, expectedVersion: lookup.resourceVersion },
          { authorityId: authorization.authorityId }
        ),
        authorization.accessToken,
        signal
      )
    assertCurrent()
    const claimed = registration.claimedFromReconcile(
      reconciled,
      identity,
      authorization.authorityId
    )
    registration.persist(claimed)
    return claimed
  }
  const pending = lookup.exists
    ? await registration.pendingFromLookup(lookup, identity, authorization.authorityId, signal)
    : await registration.registerPending(identity, authorization.authorityId, signal)
  assertCurrent()
  const client = registration.requireClient()
  const challenge = await client.createClaimChallenge(
    createRuntimeClaimChallengeRequest(
      identity,
      {
        runtimeRecordId: pending.runtimeRecordId,
        expectedVersion: pending.resourceVersion,
        expectedAccountId: authorization.accountId
      },
      { authorityId: authorization.authorityId }
    ),
    signal
  )
  assertCurrent()
  const deadline = Math.min(challenge.expiresAt, registration.now() + 300_000)
  if (deadline <= registration.now()) {
    throw new Error('hive_runtime_cloud_claim_challenge_expired')
  }
  await openVerification(challenge.userCode)
  assertCurrent()
  let nextPollAt = registration.now() + challenge.pollIntervalSeconds * 1000
  while (registration.now() < deadline) {
    await waitForPoll(
      Math.min(
        Math.max(challenge.pollIntervalSeconds * 1000, nextPollAt - registration.now()),
        30_000,
        deadline - registration.now()
      ),
      signal
    )
    assertCurrent()
    if (registration.now() >= deadline) {
      break
    }
    const polled = await client.pollClaimChallenge(
      challenge.challengeId,
      challenge.deviceCode,
      signal
    )
    assertCurrent()
    if (polled.status === 'EXPIRED') {
      break
    }
    if (polled.status === 'PENDING') {
      nextPollAt = polled.nextPollAt
      continue
    }
    if (
      polled.runtime.runtimeRecordId !== pending.runtimeRecordId ||
      polled.runtime.runtimeInstanceId !== identity.runtimeInstanceId
    ) {
      throw new Error('hive_runtime_cloud_claim_identity_mismatch')
    }
    await registration.requireCurrentAccountOwnership(
      pending.runtimeRecordId,
      authorization,
      signal
    )
    assertCurrent()
    const claimed = registration.claimedFromReconcile(
      polled.runtime,
      identity,
      authorization.authorityId
    )
    registration.persist(claimed)
    return claimed
  }
  throw new Error('hive_runtime_cloud_claim_challenge_expired')
}

function ownershipResult(
  relation: HiveLocalRuntimeOwnershipState['relation'],
  runtimeRecordId: string | null
): OwnershipAnalysis['result'] {
  return {
    relation,
    runtimeRecordId,
    claimCapabilityAvailable: false,
    errorCode: null
  }
}
