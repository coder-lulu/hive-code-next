import {
  HIVE_AGENT_METHODS,
  type AuthenticatedRuntimePrincipal,
  type HiveAgentMethod
} from '../../shared/hive-agent-session-methods'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'

export function authorizeHiveAgentMethod(input: {
  method: string
  principal: AuthenticatedRuntimePrincipal | null
  runtimeRecordId: string
  now: number
  eligibilityRevision: number
  entry?: HiveAgentSessionEntry | null
}): AuthenticatedRuntimePrincipal {
  const principal = input.principal
  const metadata = Object.hasOwn(HIVE_AGENT_METHODS, input.method)
    ? HIVE_AGENT_METHODS[input.method as HiveAgentMethod]
    : undefined
  if (
    !metadata ||
    !principal ||
    principal.kind !== 'local' ||
    principal.relayConnectionId !== undefined ||
    !principal.accountId ||
    !principal.deviceId ||
    !principal.projectScope ||
    principal.runtimeRecordId !== input.runtimeRecordId ||
    !Number.isSafeInteger(principal.expiry) ||
    principal.expiry <= input.now ||
    principal.eligibilityRevision !== input.eligibilityRevision ||
    !principal.allowedMethods.includes(metadata.requiredMethodScope) ||
    metadata.requiredToolScopes.some((scope) => !principal.toolScopes.includes(scope))
  ) {
    throw new Error('hive_agent_forbidden')
  }
  const entry = input.entry
  if (
    entry &&
    (entry.accountId !== principal.accountId ||
      entry.deviceId !== principal.deviceId ||
      entry.projectScope !== principal.projectScope ||
      (entry.deletedAt !== undefined && input.method !== 'hiveAgent.delete'))
  ) {
    throw new Error('hive_agent_forbidden')
  }
  return principal
}
