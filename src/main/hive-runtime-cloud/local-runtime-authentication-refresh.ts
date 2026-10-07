import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { HiveLocalRuntimeOwnershipState } from '../../shared/hive-runtime-cloud'
import type { LocalRuntimeRegistration } from './local-runtime-registration'
import type { LocalRuntimeOwnershipServiceOptions } from './local-runtime-ownership-contracts'
import { readHiveRuntimeCloudPresenceSession } from './hive-runtime-cloud-presence-session'

/** Retain existing ownership only against the current authoritative registration and live lease. */
export function retainsClaimedRuntimeOnAuthenticationRefresh(
  before: HiveRuntimeCloudAuthorization | null,
  after: HiveRuntimeCloudAuthorization | null,
  state: HiveLocalRuntimeOwnershipState,
  registration: LocalRuntimeRegistration,
  options: LocalRuntimeOwnershipServiceOptions
): boolean {
  if (
    !before ||
    !after ||
    before.sessionGeneration !== after.sessionGeneration ||
    state.relation !== 'CLAIMED_BY_CURRENT' ||
    state.presence !== 'ONLINE' ||
    state.checkedAt === null ||
    state.accountId !== before.accountId ||
    state.sessionGeneration !== before.sessionGeneration
  ) {
    return false
  }
  const previous = readHiveRuntimeCloudPresenceSession(before, registration.now())
  const current = readHiveRuntimeCloudPresenceSession(after, registration.now())
  if (
    !previous ||
    !current ||
    previous.accountId !== current.accountId ||
    previous.authorityId !== current.authorityId ||
    previous.cloudSessionId !== current.cloudSessionId
  ) {
    return false
  }
  try {
    const stored = registration.readState(),
      lease = options.getCurrentLeaseContext()
    const identity = registration.requireIdentity()
    return Boolean(
      stored?.status === 'CLAIMED' &&
      lease &&
      stored.runtimeRecordId === state.runtimeRecordId &&
      stored.runtimeRecordId === lease.tuple.runtimeRecordId &&
      stored.authorityId === current.authorityId &&
      lease.authorityId === current.authorityId &&
      stored.ownerAccountId === current.accountId &&
      identity.runtimeInstanceId === lease.tuple.runtimeInstanceId &&
      identity.runtimeInstanceId === lease.identity.runtimeInstanceId &&
      identity.publicKey === lease.identity.publicKey &&
      lease.tuple.bootId === options.getBootId() &&
      stored.authorityGeneration === lease.tuple.authorityGeneration &&
      stored.fencingEpoch === lease.tuple.fencingEpoch &&
      stored.latestLeaseEpoch === lease.tuple.leaseEpoch
    )
  } catch {
    return false
  }
}
