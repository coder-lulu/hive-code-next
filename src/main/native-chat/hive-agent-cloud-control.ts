import type { HiveAiTextControlClient } from '../hive-runtime-cloud/hive-ai-text-control-client'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import {
  createManagedPiSessionAuthorityResolver,
  type ManagedPiAuthoritySources
} from './managed-pi-cloud-authority'

/** Execution metadata only; a remote terminal result cannot reconstruct missing local text. */
export function createHiveAgentCloudControl(options: {
  sources: ManagedPiAuthoritySources
  client: Pick<HiveAiTextControlClient, 'status' | 'cancel'>
  signal: AbortSignal
}) {
  return async (entry: HiveAgentSessionEntry, operation: 'status' | 'cancel') => {
    const generation = entry.aggregate.generation
    if (!generation?.modelSelection || entry.aggregate.binding?.providerKind !== 'managed-pi') {
      throw new Error('hive_agent_capability_unavailable')
    }
    const resolve = createManagedPiSessionAuthorityResolver(
      options.sources,
      operation === 'status' ? 'hiveAgent.execution' : 'hiveAgent.cancel'
    )
    const request = {
      sessionId: entry.aggregate.session.sessionId,
      generationId: generation.generationId,
      requestId: generation.generationId.slice('ha-generation:'.length),
      ...generation.modelSelection
    }
    const authority = await resolve(request, options.signal)
    const reply = await options.client[operation]({
      ...authority,
      signal: options.signal,
      command: { requestId: request.requestId, runtime: authority.runtime }
    })
    authority.assertCurrent()
    if (
      reply.requestId !== request.requestId ||
      reply.generationId !== request.generationId ||
      reply.modelId !== request.modelId ||
      reply.protocol !== request.protocol
    ) {
      throw new Error('hive_agent_outcome_unknown')
    }
    return reply
  }
}
