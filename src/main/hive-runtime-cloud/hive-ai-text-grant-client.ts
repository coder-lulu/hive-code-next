import {
  HiveRuntimeCloudHttpClient,
  HiveRuntimeCloudRequestError,
  type HiveRuntimeCloudFetch
} from './hive-runtime-cloud-http-client'
import { requireHiveAiCloudOrigin } from './hive-ai-catalog-client'
import { createHiveAiTextProof, HIVE_AI_TEXT_GRANT_PATH } from './hive-ai-runtime-proof'
import { canonicalRuntimeHeartbeatBody, sha256 } from './hive-runtime-cloud-proof-core'
import {
  parseHiveAiTextGrantRequest,
  type HiveAiTextGrantRequest
} from '../../shared/hive-ai-text-grant-request'
import { hiveAiTextGrantReplySchema } from '../../shared/hive-ai-text-grant'
import {
  hiveAiRuntimeOwnerSchema,
  type HiveAiRuntimeOwner
} from '../../shared/hive-ai-text-control'
import { canonicalHiveAiTextRequest } from '../../shared/hive-ai-text-request'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'

export class HiveAiTextGrantRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null
  ) {
    super('hive_ai_grant_request_failed')
  }
}
const codes = new Set([
  'INVALID_REQUEST',
  'GRANT_REJECTED',
  'FORBIDDEN',
  'CONFLICT',
  'UNAVAILABLE',
  'CREDENTIAL_REJECTED',
  'STALE_REVISION',
  'MODEL_DISABLED',
  'UNSUPPORTED_PROTOCOL',
  'INSUFFICIENT_QUOTA'
])
type GrantInput = {
  command: HiveAiTextGrantRequest
  owner: HiveAiRuntimeOwner
  identity: HiveRuntimeCloudIdentity
  authorityId: string
  accessToken: string
  assertCurrent: () => void
  signal?: AbortSignal
}

/** Native main only: single fixed-origin POST, no refresh/retry, cache or renderer credential exposure. */
export class HiveAiTextGrantClient extends HiveRuntimeCloudHttpClient {
  constructor(origin: string, fetchImpl?: HiveRuntimeCloudFetch) {
    super(requireHiveAiCloudOrigin(origin), fetchImpl)
  }
  async issue(input: GrantInput) {
    const { accessToken, assertCurrent, signal, authorityId } = input
    try {
      if (!accessToken || accessToken.length > 8192 || /\s/.test(accessToken)) {
        throw new Error('invalid identity')
      }
      const command = parseHiveAiTextGrantRequest(input.command)
      const owner = hiveAiRuntimeOwnerSchema.parse(input.owner)
      const identity = Object.freeze({ ...input.identity })
      assertCurrent()
      if (signal?.aborted) {
        throw new Error('cancelled')
      }
      const proof = createHiveAiTextProof({
        command,
        owner,
        identity,
        authorityId,
        operation: 'grant'
      })
      assertCurrent()
      if (signal?.aborted) {
        throw new Error('cancelled')
      }
      const value = await this.request(
        HIVE_AI_TEXT_GRANT_PATH,
        JSON.parse(proof.body),
        { Authorization: `Bearer ${accessToken}`, 'X-Hive-AI-Proof': proof.header },
        200,
        signal
      )
      assertCurrent()
      if (signal?.aborted) {
        throw new Error('cancelled')
      }
      const reply = hiveAiTextGrantReplySchema.parse(value)
      const { claims } = reply.grant
      const grant = claims.grant
      const { messages: _, ...contentBinding } = command.request
      const expected = {
        ...contentBinding,
        runtime: command.runtime,
        projectScope: command.projectScope,
        ...command.pack,
        requestHash: sha256(canonicalHiveAiTextRequest(command.request)),
        credentialFence: grant.binding.credentialFence,
        gatewayRevision: grant.binding.gatewayRevision
      }
      const issued = Date.parse(grant.issuedAt),
        expires = Date.parse(grant.expiresAt),
        now = Date.now()
      if (
        reply.requestId !== command.request.requestId ||
        claims.authorityId !== authorityId ||
        canonicalRuntimeHeartbeatBody(grant.owner) !== canonicalRuntimeHeartbeatBody(owner) ||
        canonicalRuntimeHeartbeatBody(grant.binding) !== canonicalRuntimeHeartbeatBody(expected) ||
        issued > now + 30000 ||
        expires <= now ||
        expires <= issued ||
        expires - issued > 120000
      ) {
        throw new Error('invalid grant binding')
      }
      return reply.grant
    } catch (error) {
      if (error instanceof HiveRuntimeCloudRequestError) {
        throw new HiveAiTextGrantRequestError(
          error.status,
          error.category !== null && codes.has(error.category) ? error.category : null
        )
      }
      throw new Error('hive_ai_grant_unavailable')
    }
  }
}
