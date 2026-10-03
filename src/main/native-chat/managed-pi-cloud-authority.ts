import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { AiAuthorizationSource } from '../hive-runtime-cloud/hive-ai-cloud-operation'
import type { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud/hive-runtime-cloud-presence-service'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import { hiveAiRuntimeOwnerSchema } from '../../shared/hive-ai-text-control'
import { parseHiveAiTextRequest, hiveAiTextRequestSchema } from '../../shared/hive-ai-text-request'
import { authorizeHiveAgentMethod } from './hive-agent-session-authorization'
import type { HiveAgentPrincipalResolver } from './hive-agent-session-dependencies'
import type { ManagedPiCloudAuthority } from './managed-pi-cloud-inference'
import type { ManagedPiCloudRequest } from './managed-pi-cloud-request'

/** Combines existing authenticated sources, never RPC-provided owner IDs or token claims. */
export type ManagedPiAuthoritySources = {
  account: Pick<AiAuthorizationSource, 'getRuntimeCloudAuthorization'>
  presence: Pick<HiveRuntimeCloudPresenceService, 'getCurrentLeaseContext'>
  readSession: (sessionId: string) => HiveAgentSessionEntry | null | undefined
  principalForSession: (sessionId: string) => ReturnType<HiveAgentPrincipalResolver>
  eligibilityRevision: () => number
  assertOrigin: () => void
  now?: () => number
}
export function createManagedPiCloudAuthorityResolver(options: ManagedPiAuthoritySources) {
  const resolve = createManagedPiSessionAuthorityResolver(options, 'hiveAgent.submit')
  return (raw: ManagedPiCloudRequest, signal: AbortSignal) => {
    const { messages: _, ...identity } = parseHiveAiTextRequest(raw)
    return resolve(identity, signal)
  }
}
const { messages: _, ...identityFields } = hiveAiTextRequestSchema.shape
const identitySchema = z.strictObject(identityFields)
export function createManagedPiSessionAuthorityResolver(
  options: ManagedPiAuthoritySources,
  method: 'hiveAgent.submit' | 'hiveAgent.execution' | 'hiveAgent.cancel'
): (
  request: Omit<ManagedPiCloudRequest, 'messages'>,
  signal: AbortSignal
) => Promise<ManagedPiCloudAuthority> {
  const now = options.now ?? Date.now
  return async (raw, signal) => {
    const unavailable = () => new Error('hive_agent_forbidden')
    const request = identitySchema.parse(raw)
    const authorization = options.account.getRuntimeCloudAuthorization()
    const lease = options.presence.getCurrentLeaseContext()
    if (!authorization || !lease) {
      throw unavailable()
    }
    const pinnedAuthorization = Object.freeze({ ...authorization })
    const pinnedLease = {
      authorityId: lease.authorityId,
      identity: Object.freeze({ ...lease.identity }),
      tuple: Object.freeze({ ...lease.tuple })
    }
    const initial = options.readSession(request.sessionId)
    if (!initial) {
      throw unavailable()
    }
    const owner = hiveAiRuntimeOwnerSchema.parse({
      accountId: initial.accountId,
      deviceId: initial.deviceId,
      runtimeRecordId: lease.tuple.runtimeRecordId
    })
    const projectScope = initial.projectScope
    const assertCurrent = () => {
      try {
        options.assertOrigin()
        const current = options.account.getRuntimeCloudAuthorization()
        const context = options.presence.getCurrentLeaseContext()
        const entry = options.readSession(request.sessionId)
        if (
          signal.aborted ||
          !current ||
          !context ||
          !entry ||
          current.sessionExpiresAt <= now() ||
          !isDeepStrictEqual(current, pinnedAuthorization) ||
          !isDeepStrictEqual(context, pinnedLease) ||
          current.authorityId !== context.authorityId ||
          current.accountId !== owner.accountId ||
          entry.accountId !== owner.accountId ||
          entry.deviceId !== owner.deviceId ||
          entry.projectScope !== projectScope
        ) {
          throw unavailable()
        }
        const principal = authorizeHiveAgentMethod({
          method,
          principal: options.principalForSession(request.sessionId),
          entry,
          runtimeRecordId: context.tuple.runtimeRecordId,
          now: now(),
          eligibilityRevision: options.eligibilityRevision()
        })
        const generation = entry.aggregate.generation
        if (
          principal.accountId !== owner.accountId ||
          principal.deviceId !== owner.deviceId ||
          entry.aggregate.session.sessionId !== request.sessionId ||
          (method === 'hiveAgent.submit' && generation?.state !== 'RUNNING') ||
          generation?.generationId !== request.generationId ||
          request.requestId !== request.generationId.slice('ha-generation:'.length) ||
          generation.modelSelection?.modelId !== request.modelId ||
          generation.modelSelection?.protocol !== request.protocol ||
          generation.modelSelection?.snapshotRevision !== request.snapshotRevision
        ) {
          throw unavailable()
        }
      } catch {
        throw unavailable()
      }
    }
    assertCurrent()
    return Object.freeze({
      owner,
      projectScope,
      runtime: pinnedLease.tuple,
      identity: pinnedLease.identity,
      authorityId: pinnedLease.authorityId,
      accessToken: pinnedAuthorization.accessToken,
      assertCurrent
    })
  }
}
