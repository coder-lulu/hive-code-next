import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import type { HiveAgentHostDependencies } from './hive-agent-session-dependencies'
import { hiveAgentMethodSchemas } from '../../shared/hive-agent-session-methods'

export function publicHiveAgentAggregate(entry: HiveAgentSessionEntry) {
  const aggregate = structuredClone(entry.aggregate)
  if (aggregate.binding) {
    delete aggregate.binding.encryptedSecretRef
  }
  return aggregate
}
export async function readHiveAgentExecution(
  deps: HiveAgentHostDependencies,
  raw: unknown,
  entry: HiveAgentSessionEntry,
  authorize: () => unknown
) {
  const { generationId } = hiveAgentMethodSchemas['hiveAgent.execution'].parse(raw)
  if (entry.aggregate.generation?.generationId !== generationId) {
    throw new Error('hive_agent_stale_generation')
  }
  if (!deps.queryExecution) {
    throw new Error('hive_agent_capability_unavailable')
  }
  const value = await deps.queryExecution(entry)
  authorize()
  const current = deps.store.hive.get(entry.aggregate.session.sessionId)
  if (current?.aggregate.generation?.generationId !== generationId) {
    throw new Error('hive_agent_stale_generation')
  }
  return { ok: true, value }
}
