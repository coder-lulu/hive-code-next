import { randomUUID } from 'node:crypto'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { hiveAgentBindingSchema } from '../../shared/hive-agent-session-schema'

/** Explicit external-provider reference, not a managed-pi execution fallback or lease copy. */
export function referenceExistingAgentBinding(
  record: Pick<AgentSessionRecord, 'sessionId' | 'provider' | 'providerHandleChain'>
) {
  const handle = record.providerHandleChain.at(-1)?.handle
  if (!handle || handle.provider !== record.provider) {
    throw new Error('hive_agent_capability_unavailable')
  }
  return hiveAgentBindingSchema.parse({
    schemaVersion: 1,
    bindingId: `ha-binding:${randomUUID()}`,
    providerKind: record.provider,
    providerSessionRef: handle.provider === 'codex' ? handle.threadId : handle.sessionId,
    runtimeRecordRef: record.sessionId,
    capabilityRevision: 0,
    capabilities: []
  })
}
