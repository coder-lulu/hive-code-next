import { createHiveAgentSessionClient } from './hive-agent-session-client'
import { createAgentSessionOperationId } from './agent-session-operation-id'

/** Retire local history only after its owned execution is no longer active. */
export async function retireHiveAgentSession(projectSelector: string, sessionId: string) {
  const controller = new AbortController()
  const client = createHiveAgentSessionClient({
    projectSelector,
    signal: controller.signal,
    call: window.api.runtime.call
  })
  try {
    const current = await client.read(sessionId)
    const generation = current.generation
    if (generation && ['RUNNING', 'PENDING'].includes(generation.state)) {
      const receipt = await client.mutate('hiveAgent.cancel', {
        sessionId,
        generationId: generation.generationId,
        operationId: createAgentSessionOperationId()
      })
      if (receipt.status !== 'succeeded') {
        throw new Error('hive_agent_outcome_unknown')
      }
    }
    const deleted = await client.mutate('hiveAgent.delete', {
      sessionId,
      operationId: createAgentSessionOperationId()
    })
    if (deleted.status !== 'succeeded') {
      throw new Error('hive_agent_outcome_unknown')
    }
  } finally {
    controller.abort()
  }
}
