import {
  normalizeClaim,
  normalizeConnectionTicketConsume,
  normalizeHeartbeat,
  normalizeLease,
  normalizeLookup,
  normalizeRegistration,
  type RuntimeClaim,
  type RuntimeConnectionTicketConsume,
  type RuntimeHeartbeat,
  type RuntimeLease,
  type RuntimeRegistration,
  type RuntimeRegistrationLookup
} from './hive-runtime-cloud-response'
import {
  normalizeWebSessionControlPull,
  type RuntimeWebSessionControlPull
} from './hive-runtime-cloud-web-session-control-response'
import {
  normalizeClaimCapabilityReissue,
  normalizeClaimChallenge,
  normalizeClaimChallengePoll,
  normalizeClaimReconcile,
  type RuntimeClaimCapabilityReissue,
  type RuntimeClaimChallenge,
  type RuntimeClaimChallengePoll,
  type RuntimeClaimReconcile
} from './hive-runtime-cloud-claim-response'
import { normalizeHiveRuntimeCloudAuthorityId } from './hive-runtime-cloud-capabilities-response'
import { HiveRuntimeCloudAccountClient } from './hive-runtime-cloud-account-client'

export type {
  RuntimeClaim,
  RuntimeConnectionTicketConsume,
  RuntimeHeartbeat,
  RuntimeLease,
  RuntimeRegistration,
  RuntimeRegistrationLookup
} from './hive-runtime-cloud-response'
export type { RuntimeWebSessionControlPull } from './hive-runtime-cloud-web-session-control-response'
export type {
  RuntimeClaimCapabilityReissue,
  RuntimeClaimChallenge,
  RuntimeClaimChallengePoll,
  RuntimeClaimReconcile
} from './hive-runtime-cloud-claim-response'
export {
  HiveRuntimeCloudRequestError,
  HiveRuntimeCloudTransportError
} from './hive-runtime-cloud-http-client'

export class HiveRuntimeCloudClient extends HiveRuntimeCloudAccountClient {
  private pinnedAuthorityId: string | null = null

  async lookup(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeRegistrationLookup> {
    return normalizeLookup(
      await this.request('/hive/v1/runtime-registrations/lookup', request, {}, 200, signal)
    )
  }

  async getAuthorityId(signal?: AbortSignal): Promise<string> {
    if (this.pinnedAuthorityId) {
      return this.pinnedAuthorityId
    }
    const response = await this.get('/hive/v1/meta/capabilities', null, signal)
    const authorityId = normalizeHiveRuntimeCloudAuthorityId(response.value)
    if (this.pinnedAuthorityId && this.pinnedAuthorityId !== authorityId) {
      throw new Error('hive_runtime_cloud_authority_changed')
    }
    this.pinnedAuthorityId = authorityId
    return authorityId
  }

  async register(
    request: Record<string, unknown>,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<RuntimeRegistration> {
    return normalizeRegistration(
      await this.request(
        '/hive/v1/runtime-registrations',
        request,
        { 'idempotency-key': idempotencyKey },
        201,
        signal
      )
    )
  }

  async claim(
    request: Record<string, unknown>,
    accessToken: string,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<RuntimeClaim> {
    return normalizeClaim(
      await this.request(
        '/hive/v1/runtime-claims',
        request,
        { authorization: `Bearer ${accessToken}`, 'idempotency-key': idempotencyKey },
        200,
        signal
      )
    )
  }

  async reissueClaimCapability(
    runtimeRecordId: string,
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeClaimCapabilityReissue> {
    return normalizeClaimCapabilityReissue(
      await this.request(
        `/hive/v1/runtime-records/${encodeURIComponent(runtimeRecordId)}/reclaim-capabilities`,
        request,
        {},
        200,
        signal
      )
    )
  }

  async reconcileClaim(
    runtimeRecordId: string,
    request: Record<string, unknown>,
    accessToken: string,
    signal?: AbortSignal
  ): Promise<RuntimeClaimReconcile> {
    return normalizeClaimReconcile(
      await this.request(
        `/hive/v1/runtime-records/${encodeURIComponent(runtimeRecordId)}/claim-reconcile`,
        request,
        { authorization: `Bearer ${accessToken}` },
        200,
        signal
      )
    )
  }

  async createClaimChallenge(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeClaimChallenge> {
    return normalizeClaimChallenge(
      await this.request('/hive/v1/runtime-claim-challenges', request, {}, 201, signal)
    )
  }

  async pollClaimChallenge(
    challengeId: string,
    deviceCode: string,
    signal?: AbortSignal
  ): Promise<RuntimeClaimChallengePoll> {
    return normalizeClaimChallengePoll(
      await this.request(
        `/hive/v1/runtime-claim-challenges/${encodeURIComponent(challengeId)}/poll`,
        { deviceCode },
        {},
        200,
        signal
      )
    )
  }

  async acquireLease(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeLease> {
    return normalizeLease(
      await this.request('/hive/v1/runtime-leases/acquire', request, {}, 201, signal)
    )
  }

  async heartbeat(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeHeartbeat> {
    return normalizeHeartbeat(
      await this.request('/hive/v1/runtime-heartbeats', request, {}, 200, signal)
    )
  }

  async consumeConnectionTicket(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeConnectionTicketConsume> {
    return normalizeConnectionTicketConsume(
      await this.request('/hive/v1/connection-tickets', request, {}, 200, signal)
    )
  }

  async pullWebSessionControls(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<RuntimeWebSessionControlPull> {
    return normalizeWebSessionControlPull(
      await this.request('/hive/v1/runtime-web-sessions/control-pull', request, {}, 200, signal)
    )
  }

  async acknowledgeWebSessionRevocations(
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<void> {
    await this.request('/hive/v1/runtime-web-sessions/revocation-acks', request, {}, 204, signal)
  }
}
