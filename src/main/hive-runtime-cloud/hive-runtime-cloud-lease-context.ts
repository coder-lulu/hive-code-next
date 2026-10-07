import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type { AcceptedHeartbeatLease } from './hive-runtime-cloud-heartbeat'
import { ReconcilePresenceError } from './hive-runtime-cloud-presence-support'
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
  private accepted: {
    lease: ActiveLease
    proof: AcceptedHeartbeatLease
    notified: boolean
  } | null = null
  private expiryTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly now: () => number,
    private readonly onExpired: () => void
  ) {}

  accept(lease: ActiveLease, proof: AcceptedHeartbeatLease | null): void {
    const previous = this.accepted
    if (proof) {
      if (
        previous?.lease === lease &&
        proof.acceptedHeartbeatSeq <= previous.proof.acceptedHeartbeatSeq
      ) {
        throw new ReconcilePresenceError('heartbeat_sequence_stale')
      }
      this.clearExpiryTimer()
      this.accepted = { lease, proof, notified: false }
      this.scheduleExpiry()
    }
    if (!this.isLive(lease)) {
      throw new ReconcilePresenceError('heartbeat_lease_unavailable')
    }
  }

  private remaining(): number {
    const proof = this.accepted!.proof
    const duration = proof.leaseExpiresAt - proof.observedAt
    // Server wall offset grants no extra lifetime; all request/response latency consumes its budget.
    return Math.min(
      proof.requestedAt + duration - this.now(),
      proof.requestedMonotonic + duration - performance.now()
    )
  }

  private isLive(lease: ActiveLease): boolean {
    const accepted = this.accepted
    if (!accepted || accepted.lease !== lease || accepted.notified) {
      return false
    }
    if (this.remaining() > 0) {
      return true
    }
    if (!accepted.notified) {
      accepted.notified = true
      this.clearExpiryTimer()
      this.onExpired()
      this.publish(null)
    }
    return false
  }

  private scheduleExpiry(): void {
    const accepted = this.accepted!
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = undefined
        if (this.accepted === accepted && this.isLive(accepted.lease)) {
          this.scheduleExpiry()
        }
      },
      Math.min(2_147_483_647, Math.max(0, this.remaining()))
    )
    this.expiryTimer.unref?.()
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer !== undefined) {
      clearTimeout(this.expiryTimer)
    }
    this.expiryTimer = undefined
  }

  setIdentity(identity: HiveRuntimeCloudIdentity, runtimeRecordId: string): void {
    this.identity = identity
    this.runtimeRecordId = runtimeRecordId
  }

  clearIdentity(): void {
    this.clearExpiryTimer()
    this.accepted = null
    this.identity = null
    this.runtimeRecordId = null
  }

  current(
    state: HiveRuntimeCloudPresenceState,
    authorityId: string | null,
    lease: ActiveLease | null
  ): CurrentHiveRuntimeCloudLeaseContext | null {
    if (
      state !== 'ONLINE' ||
      !authorityId ||
      !this.identity ||
      !this.runtimeRecordId ||
      !lease ||
      !this.isLive(lease)
    ) {
      return null
    }
    return {
      authorityId,
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
      try {
        listener(context)
      } catch {
        // One observer cannot prevent other connections from losing Cloud authority.
      }
    }
  }
}
