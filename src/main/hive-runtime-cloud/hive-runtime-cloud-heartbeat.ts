import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type { RuntimeHeartbeat } from './hive-runtime-cloud-response'
import {
  createRuntimeHeartbeatRequest,
  type HiveRuntimeCloudReport
} from './hive-runtime-cloud-proof'
import {
  FatalPresenceError,
  type ActiveLease,
  type PresenceClient
} from './hive-runtime-cloud-presence-support'

export type PendingHeartbeat = Parameters<typeof createRuntimeHeartbeatRequest>[1]

export type HeartbeatOptions = {
  client: PresenceClient
  identity: HiveRuntimeCloudIdentity
  authorityId: string
  lease: ActiveLease
  pending: PendingHeartbeat | null
  report: HiveRuntimeCloudReport
  now: () => number
  signal: AbortSignal
  onPrepared: (pending: PendingHeartbeat) => void
  assertCurrent: () => void
  onAccepted?: (response: RuntimeHeartbeat, sent: PendingHeartbeat) => void
}

export async function sendHiveRuntimeCloudHeartbeat(options: HeartbeatOptions): Promise<number> {
  const pending =
    options.pending ??
    ({
      bootId: options.lease.bootId,
      leaseId: options.lease.leaseId,
      authorityGeneration: options.lease.authorityGeneration,
      leaseEpoch: options.lease.leaseEpoch,
      fencingEpoch: options.lease.fencingEpoch,
      heartbeatSeq: options.lease.nextHeartbeatSeq,
      sourceReportedAt: new Date(options.now()).toISOString(),
      report: structuredClone(options.report)
    } satisfies PendingHeartbeat)
  options.onPrepared(pending)
  const heartbeat = await options.client.heartbeat(
    createRuntimeHeartbeatRequest(options.identity, pending, {
      authorityId: options.authorityId
    }),
    options.signal
  )
  options.assertCurrent()
  if (
    heartbeat.leaseId !== options.lease.leaseId ||
    heartbeat.authorityGeneration !== options.lease.authorityGeneration ||
    heartbeat.leaseEpoch !== options.lease.leaseEpoch ||
    heartbeat.fencingEpoch !== options.lease.fencingEpoch ||
    heartbeat.acceptedHeartbeatSeq !== pending.heartbeatSeq
  ) {
    throw new FatalPresenceError('heartbeat_tuple_mismatch')
  }
  if (heartbeat.presence === 'FENCED') {
    throw new FatalPresenceError('heartbeat_fenced')
  }
  if (pending.report.relayControl && heartbeat.responseVersion !== 'runtime-session-control/v1') {
    throw new FatalPresenceError('heartbeat_relay_control_missing')
  }
  options.onAccepted?.(heartbeat, pending)
  options.assertCurrent()
  return heartbeat.acceptedHeartbeatSeq + 1
}
