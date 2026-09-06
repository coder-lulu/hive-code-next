import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { RuntimeClaimReconcile, RuntimeRegistrationLookup } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import {
  createRuntimeClaimCapabilityReissueRequest,
  createRuntimeRegistrationLookupRequest,
  createRuntimeRegistrationRequest
} from './hive-runtime-cloud-proof'
import { publicKeyDigest } from './hive-runtime-cloud-presence-support'
import type { HiveRuntimeCloudRegistrationState } from './hive-runtime-cloud-state-store'
import type {
  LocalRuntimeOwnershipDependencies,
  LocalRuntimeOwnershipServiceOptions,
  OwnershipClient
} from './local-runtime-ownership-contracts'

export type ExistingLookup = Extract<RuntimeRegistrationLookup, { exists: true }>
export type PendingRegistration = Extract<
  HiveRuntimeCloudRegistrationState,
  { status: 'PENDING_CLAIM' }
>
export type ClaimedRegistration = Extract<HiveRuntimeCloudRegistrationState, { status: 'CLAIMED' }>

export class LocalRuntimeRegistration {
  private readonly client: OwnershipClient | null

  constructor(
    private readonly options: LocalRuntimeOwnershipServiceOptions,
    private readonly dependencies: LocalRuntimeOwnershipDependencies
  ) {
    this.client = options.config.enabled
      ? dependencies.createClient(options.config.apiBaseUrl)
      : null
  }

  isAvailable(): boolean {
    return this.client !== null
  }

  requireClient(): OwnershipClient {
    if (!this.client) {
      throw new Error('hive_runtime_cloud_unavailable')
    }
    return this.client
  }

  now(): number {
    return this.dependencies.now()
  }

  randomUuid(): string {
    return this.dependencies.randomUuid()
  }

  clearRegistration(): void {
    this.dependencies.clearState(this.options.userDataPath)
  }

  clearCloudIdentity(): void {
    this.dependencies.clearState(this.options.userDataPath)
    this.dependencies.clearIdentity(this.options.userDataPath)
  }

  requireIdentity(expectedRuntimeInstanceId?: string): HiveRuntimeCloudIdentity {
    const loaded = this.dependencies.loadIdentity(this.options.userDataPath)
    if (loaded.status !== 'ok') {
      throw new Error(
        loaded.status === 'unavailable'
          ? 'hive_runtime_cloud_identity_unavailable'
          : 'hive_runtime_cloud_identity_unreadable'
      )
    }
    if (
      expectedRuntimeInstanceId &&
      loaded.identity.runtimeInstanceId !== expectedRuntimeInstanceId
    ) {
      throw new Error('hive_runtime_cloud_claim_identity_mismatch')
    }
    return loaded.identity
  }

  readState(): HiveRuntimeCloudRegistrationState | null {
    const stored = this.dependencies.readState(this.options.userDataPath)
    if (stored.status === 'unavailable' || stored.status === 'unreadable') {
      throw new Error('hive_runtime_cloud_registration_state_unavailable')
    }
    return stored.status === 'ok' ? stored.value : null
  }

  persist(state: HiveRuntimeCloudRegistrationState): void {
    if (!this.dependencies.saveState(this.options.userDataPath, state)) {
      throw new Error('hive_runtime_cloud_registration_state_write_failed')
    }
  }

  async requireAccountAuthority(
    authorization: HiveRuntimeCloudAuthorization,
    signal: AbortSignal
  ): Promise<void> {
    const authorityId = await this.requireClient().getAuthorityId(signal)
    if (authorityId !== authorization.authorityId) {
      throw new Error('hive_runtime_cloud_authority_mismatch')
    }
  }

  async lookup(
    identity: HiveRuntimeCloudIdentity,
    authorityId: string,
    signal: AbortSignal
  ): Promise<RuntimeRegistrationLookup> {
    const lookup = await this.requireClient().lookup(
      createRuntimeRegistrationLookupRequest(identity, { authorityId }),
      signal
    )
    if (lookup.exists && lookup.identityPublicKeySha256 !== publicKeyDigest(identity)) {
      throw new Error('hive_runtime_cloud_registration_identity_mismatch')
    }
    return lookup
  }

  async registerPending(
    identity: HiveRuntimeCloudIdentity,
    authorityId: string,
    signal: AbortSignal
  ): Promise<PendingRegistration> {
    const report = this.options.getReport()
    const created = await this.requireClient().register(
      createRuntimeRegistrationRequest(
        identity,
        {
          bootId: this.options.getBootId(),
          runtimeVersion: report.runtimeVersion,
          capabilities: report.capabilities
        },
        { authorityId }
      ),
      this.randomUuid(),
      signal
    )
    if (created.runtimeInstanceId !== identity.runtimeInstanceId) {
      throw new Error('hive_runtime_cloud_registration_identity_mismatch')
    }
    const pending: PendingRegistration = {
      schemaVersion: 1,
      runtimeRecordId: created.runtimeRecordId,
      status: 'PENDING_CLAIM',
      authorityId,
      resourceVersion: created.resourceVersion,
      authorityGeneration: 1,
      fencingEpoch: 1,
      latestLeaseEpoch: 0,
      claimCapability: created.claimCapability,
      claimExpiresAt: created.claimExpiresAt
    }
    this.persist(pending)
    return pending
  }

  async pendingFromLookup(
    lookup: ExistingLookup,
    identity: HiveRuntimeCloudIdentity,
    authorityId: string,
    signal: AbortSignal
  ): Promise<PendingRegistration> {
    if (lookup.status !== 'PENDING_CLAIM' && lookup.status !== 'UNLINKED') {
      throw new Error('hive_runtime_cloud_claim_state_invalid')
    }
    const stored = this.readState()
    if (
      stored?.status === 'PENDING_CLAIM' &&
      stored.runtimeRecordId === lookup.runtimeRecordId &&
      (!stored.authorityId || stored.authorityId === authorityId) &&
      stored.claimExpiresAt > this.now()
    ) {
      const pending = {
        ...stored,
        authorityId,
        resourceVersion: lookup.resourceVersion,
        authorityGeneration: lookup.authorityGeneration,
        fencingEpoch: lookup.fencingEpoch,
        latestLeaseEpoch: lookup.latestLeaseEpoch
      }
      this.persist(pending)
      return pending
    }
    const reissued = await this.requireClient().reissueClaimCapability(
      lookup.runtimeRecordId,
      createRuntimeClaimCapabilityReissueRequest(
        identity,
        { runtimeRecordId: lookup.runtimeRecordId, expectedVersion: lookup.resourceVersion },
        { authorityId }
      ),
      signal
    )
    if (reissued.runtimeRecordId !== lookup.runtimeRecordId) {
      throw new Error('hive_runtime_cloud_registration_identity_mismatch')
    }
    const pending: PendingRegistration = {
      schemaVersion: 1,
      runtimeRecordId: lookup.runtimeRecordId,
      status: 'PENDING_CLAIM',
      authorityId,
      resourceVersion: reissued.resourceVersion,
      authorityGeneration: lookup.authorityGeneration,
      fencingEpoch: lookup.fencingEpoch,
      latestLeaseEpoch: lookup.latestLeaseEpoch,
      claimCapability: reissued.claimCapability,
      claimExpiresAt: reissued.claimExpiresAt
    }
    this.persist(pending)
    return pending
  }

  claimedFromLookup(lookup: ExistingLookup, authorityId: string): ClaimedRegistration {
    if (lookup.status !== 'CLAIMED') {
      throw new Error('hive_runtime_cloud_claim_state_invalid')
    }
    return {
      schemaVersion: 1,
      runtimeRecordId: lookup.runtimeRecordId,
      status: 'CLAIMED',
      authorityId,
      resourceVersion: lookup.resourceVersion,
      authorityGeneration: lookup.authorityGeneration,
      fencingEpoch: lookup.fencingEpoch,
      latestLeaseEpoch: lookup.latestLeaseEpoch
    }
  }

  claimedFromReconcile(
    reconciled: RuntimeClaimReconcile,
    identity: HiveRuntimeCloudIdentity,
    authorityId: string
  ): ClaimedRegistration {
    if (reconciled.runtimeInstanceId !== identity.runtimeInstanceId) {
      throw new Error('hive_runtime_cloud_claim_identity_mismatch')
    }
    return {
      schemaVersion: 1,
      runtimeRecordId: reconciled.runtimeRecordId,
      status: 'CLAIMED',
      authorityId,
      resourceVersion: reconciled.resourceVersion,
      authorityGeneration: reconciled.authorityGeneration,
      fencingEpoch: reconciled.fencingEpoch,
      latestLeaseEpoch: reconciled.latestLeaseEpoch
    }
  }

  async requireCurrentAccountOwnership(
    runtimeRecordId: string,
    authorization: HiveRuntimeCloudAuthorization,
    signal: AbortSignal
  ): Promise<void> {
    const owned = await this.requireClient().getOwnedRuntime(
      runtimeRecordId,
      authorization.accessToken,
      signal
    )
    if (owned.runtimeRecordId !== runtimeRecordId) {
      throw new Error('hive_runtime_cloud_directory_identity_mismatch')
    }
  }
}

export function sameRegistrationTuple(
  current: HiveRuntimeCloudRegistrationState | null,
  next: ClaimedRegistration
): boolean {
  return (
    current?.status === 'CLAIMED' &&
    current.runtimeRecordId === next.runtimeRecordId &&
    current.resourceVersion === next.resourceVersion &&
    current.authorityGeneration === next.authorityGeneration &&
    current.fencingEpoch === next.fencingEpoch &&
    current.latestLeaseEpoch === next.latestLeaseEpoch &&
    current.authorityId === next.authorityId
  )
}
