import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type { RuntimeHeartbeat } from './hive-runtime-cloud-response'
import {
  withHiveRuntimeCloudPresenceSession,
  type HiveRuntimeCloudPresenceSessionSource
} from './hive-runtime-cloud-presence-session'
import {
  createRuntimeHeartbeatRequest,
  type HiveRuntimeCloudReport
} from './hive-runtime-cloud-proof'
import {
  FatalPresenceError,
  ReconcilePresenceError,
  type ActiveLease,
  type PresenceClient
} from './hive-runtime-cloud-presence-support'

export type PendingHeartbeat = Parameters<typeof createRuntimeHeartbeatRequest>[1]
export type HeartbeatRequestTiming = Readonly<{ requestedAt: number; requestedMonotonic: number }>

export type AcceptedHeartbeatLease = Readonly<{
  acceptedHeartbeatSeq: number
  observedAt: number
  leaseExpiresAt: number
  requestedAt: number
  requestedMonotonic: number
  receivedAt: number
  receivedMonotonic: number
}>

export type HeartbeatOptions = {
  client: PresenceClient
  authorization: HiveRuntimeCloudPresenceSessionSource
  identity: HiveRuntimeCloudIdentity
  authorityId: string
  lease: ActiveLease
  pending: PendingHeartbeat | null
  pendingTiming: HeartbeatRequestTiming | null
  report: HiveRuntimeCloudReport
  now: () => number
  signal: AbortSignal
  onPrepared: (pending: PendingHeartbeat, timing: HeartbeatRequestTiming) => void
  assertCurrent: () => void
  onAccepted?: (
    response: RuntimeHeartbeat,
    sent: PendingHeartbeat,
    proof: AcceptedHeartbeatLease | null
  ) => void
}

export async function sendHiveRuntimeCloudHeartbeat(options: HeartbeatOptions) {
  options.assertCurrent()
  const authorization = options.authorization()
  if (!authorization) {
    throw new FatalPresenceError('runtime_login_required')
  }
  const pending =
    options.pending ??
    ({
      bootId: options.lease.bootId,
      cloudSessionId: authorization.cloudSessionId,
      leaseId: options.lease.leaseId,
      authorityGeneration: options.lease.authorityGeneration,
      leaseEpoch: options.lease.leaseEpoch,
      fencingEpoch: options.lease.fencingEpoch,
      heartbeatSeq: options.lease.nextHeartbeatSeq,
      sourceReportedAt: new Date(options.now()).toISOString(),
      report: structuredClone(options.report)
    } satisfies PendingHeartbeat)
  if (pending.cloudSessionId !== authorization.cloudSessionId) {
    throw new FatalPresenceError('heartbeat_session_mismatch')
  }
  options.assertCurrent()
  const timing = options.pending
    ? options.pendingTiming
    : {
        requestedAt: options.now(),
        requestedMonotonic: performance.now()
      }
  if (!timing) {
    throw new FatalPresenceError('heartbeat_request_timing_unavailable')
  }
  const { requestedAt, requestedMonotonic } = timing
  options.onPrepared(pending, timing)
  const heartbeat = await withHiveRuntimeCloudPresenceSession(
    authorization,
    options.authorization,
    options.assertCurrent,
    (current) =>
      options.client.heartbeat(
        createRuntimeHeartbeatRequest(options.identity, pending, {
          authorityId: options.authorityId
        }),
        current.accessToken,
        options.signal
      )
  )
  options.assertCurrent()
  const receivedAt = options.now(),
    receivedMonotonic = performance.now()
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
  const duration = heartbeat.leaseExpiresAt - heartbeat.observedAt
  if (
    options.signal.aborted ||
    heartbeat.presence !== 'ONLINE' ||
    !Number.isSafeInteger(heartbeat.observedAt) ||
    !Number.isSafeInteger(heartbeat.leaseExpiresAt) ||
    heartbeat.observedAt <= 0 ||
    duration <= 0 ||
    requestedAt + duration <= receivedAt ||
    requestedMonotonic + duration <= receivedMonotonic
  ) {
    throw new ReconcilePresenceError('heartbeat_lease_expired')
  }
  if (pending.report.relayControl && heartbeat.responseVersion !== 'runtime-session-control/v1') {
    throw new FatalPresenceError('heartbeat_relay_control_missing')
  }
  const acceptedLease = heartbeat.duplicate
    ? null
    : ({
        acceptedHeartbeatSeq: heartbeat.acceptedHeartbeatSeq,
        observedAt: heartbeat.observedAt,
        leaseExpiresAt: heartbeat.leaseExpiresAt,
        requestedAt,
        requestedMonotonic,
        receivedAt,
        receivedMonotonic
      } satisfies AcceptedHeartbeatLease)
  options.onAccepted?.(heartbeat, pending, acceptedLease)
  options.assertCurrent()
  return {
    nextHeartbeatSeq: heartbeat.acceptedHeartbeatSeq + 1,
    acceptedLease
  }
}
