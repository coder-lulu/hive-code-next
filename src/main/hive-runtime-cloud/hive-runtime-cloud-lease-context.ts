import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type {
  ActiveLease,
  HiveRuntimeCloudPresenceState
} from './hive-runtime-cloud-presence-support'

export type HiveRuntimeCloudTuple = Readonly<{
  authorityGeneration: number
  runtimeRecordId: string
  runtimeInstanceId: string
  bootId: string
  heartbeatLeaseId: string
  leaseEpoch: number
  fencingEpoch: number
}>

export type CurrentHiveRuntimeCloudLeaseContext = Readonly<{
  authorityId: string
  identity: HiveRuntimeCloudIdentity
  tuple: HiveRuntimeCloudTuple
}>

export type HiveRuntimeCloudLeaseContextListener = (
  context: CurrentHiveRuntimeCloudLeaseContext | null
) => void

export class HiveRuntimeCloudLeaseContextPublisher {
  private identity: HiveRuntimeCloudIdentity | null = null
  private runtimeRecordId: string | null = null
  private readonly listeners = new Set<HiveRuntimeCloudLeaseContextListener>()

  setIdentity(identity: HiveRuntimeCloudIdentity, runtimeRecordId: string): void {
    this.identity = identity
    this.runtimeRecordId = runtimeRecordId
  }

  clearIdentity(): void {
    this.identity = null
    this.runtimeRecordId = null
  }

  current(
    state: HiveRuntimeCloudPresenceState,
    authorization: HiveRuntimeCloudAuthorization | null,
    lease: ActiveLease | null
  ): CurrentHiveRuntimeCloudLeaseContext | null {
    if (state !== 'ONLINE' || !authorization || !this.identity || !this.runtimeRecordId || !lease) {
      return null
    }
    return {
      authorityId: authorization.authorityId,
      identity: this.identity,
      tuple: {
        authorityGeneration: lease.authorityGeneration,
        runtimeRecordId: this.runtimeRecordId,
        runtimeInstanceId: this.identity.runtimeInstanceId,
        bootId: lease.bootId,
        heartbeatLeaseId: lease.leaseId,
        leaseEpoch: lease.leaseEpoch,
        fencingEpoch: lease.fencingEpoch
      }
    }
  }

  subscribe(
    listener: HiveRuntimeCloudLeaseContextListener,
    current: () => CurrentHiveRuntimeCloudLeaseContext | null
  ): () => void {
    this.listeners.add(listener)
    listener(current())
    return () => this.listeners.delete(listener)
  }

  publish(context: CurrentHiveRuntimeCloudLeaseContext | null): void {
    for (const listener of this.listeners) {
      listener(context)
    }
  }
}
