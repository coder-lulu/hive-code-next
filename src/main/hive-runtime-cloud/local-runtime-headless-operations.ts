import type {
  HiveLocalRuntimeClaimPollResult,
  HiveLocalRuntimeClaimStartResult
} from '../../shared/hive-runtime-cloud'
import { createRuntimeClaimChallengeRequest } from './hive-runtime-cloud-proof'
import type { HeadlessClaim } from './local-runtime-ownership-contracts'
import type { LocalRuntimeRegistration } from './local-runtime-registration'

type HeadlessOperation = Readonly<{
  registration: LocalRuntimeRegistration
  signal: AbortSignal
  assertCurrent: () => void
}>

export type HeadlessClaimStart = Readonly<{
  result: HiveLocalRuntimeClaimStartResult
  challenge: HeadlessClaim | null
  registrationChanged: boolean
}>

export type HeadlessClaimPoll = Readonly<{
  result: HiveLocalRuntimeClaimPollResult
  challenge: HeadlessClaim | null
  registrationChanged: boolean
}>

export async function beginHeadlessRuntimeClaim({
  registration,
  signal,
  assertCurrent
}: HeadlessOperation): Promise<HeadlessClaimStart> {
  const client = registration.requireClient()
  const authorityId = await client.getAuthorityId(signal)
  assertCurrent()
  const identity = registration.requireIdentity()
  const lookup = await registration.lookup(identity, authorityId, signal)
  assertCurrent()
  let runtimeRecordId: string
  let expectedVersion: number
  if (!lookup.exists) {
    const pending = await registration.registerPending(identity, authorityId, signal)
    runtimeRecordId = pending.runtimeRecordId
    expectedVersion = pending.resourceVersion
  } else {
    const stored = registration.readState()
    if (
      lookup.status === 'CLAIMED' &&
      stored?.status === 'CLAIMED' &&
      stored.runtimeRecordId === lookup.runtimeRecordId &&
      (!stored.authorityId || stored.authorityId === authorityId)
    ) {
      const claimed = registration.claimedFromLookup(lookup, authorityId)
      registration.persist(claimed)
      return {
        result: { status: 'CLAIMED', runtimeRecordId: claimed.runtimeRecordId },
        challenge: null,
        registrationChanged: true
      }
    }
    if (lookup.status === 'PENDING_CLAIM') {
      const pending = await registration.pendingFromLookup(lookup, identity, authorityId, signal)
      runtimeRecordId = pending.runtimeRecordId
      expectedVersion = pending.resourceVersion
    } else {
      runtimeRecordId = lookup.runtimeRecordId
      expectedVersion = lookup.resourceVersion
    }
  }
  assertCurrent()
  const created = await client.createClaimChallenge(
    createRuntimeClaimChallengeRequest(
      identity,
      { runtimeRecordId, expectedVersion },
      { authorityId }
    ),
    signal
  )
  assertCurrent()
  if (created.expiresAt <= registration.now()) {
    throw new Error('hive_runtime_cloud_claim_challenge_expired')
  }
  const challenge: HeadlessClaim = {
    challengeId: created.challengeId,
    deviceCode: created.deviceCode,
    runtimeRecordId,
    runtimeInstanceId: identity.runtimeInstanceId,
    authorityId,
    expiresAt: created.expiresAt
  }
  return {
    result: {
      status: 'PENDING',
      runtimeRecordId,
      challengeId: created.challengeId,
      userCode: created.userCode,
      verificationUri: created.verificationUri,
      expiresAt: created.expiresAt,
      pollIntervalSeconds: created.pollIntervalSeconds
    },
    challenge,
    registrationChanged: false
  }
}

export async function pollHeadlessRuntimeClaim(
  operation: HeadlessOperation &
    Readonly<{ challenge: HeadlessClaim; onTerminalResult: () => void }>
): Promise<HeadlessClaimPoll> {
  const { registration, signal, assertCurrent, challenge, onTerminalResult } = operation
  const polled = await registration
    .requireClient()
    .pollClaimChallenge(challenge.challengeId, challenge.deviceCode, signal)
  assertCurrent()
  if (polled.status === 'PENDING') {
    return {
      result: {
        status: 'PENDING',
        challengeId: challenge.challengeId,
        nextPollAt: polled.nextPollAt
      },
      challenge,
      registrationChanged: false
    }
  }
  onTerminalResult()
  if (polled.status === 'EXPIRED') {
    return {
      result: { status: 'EXPIRED', challengeId: challenge.challengeId },
      challenge: null,
      registrationChanged: false
    }
  }
  const claimed = registration.claimedFromReconcile(
    polled.runtime,
    registration.requireIdentity(challenge.runtimeInstanceId),
    challenge.authorityId
  )
  if (claimed.runtimeRecordId !== challenge.runtimeRecordId) {
    throw new Error('hive_runtime_cloud_claim_identity_mismatch')
  }
  registration.persist(claimed)
  return {
    result: { status: 'CLAIMED', runtimeRecordId: claimed.runtimeRecordId },
    challenge: null,
    registrationChanged: true
  }
}
