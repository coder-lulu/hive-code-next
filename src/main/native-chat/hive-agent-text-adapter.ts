import type { HiveAgentContextMessage } from '../../shared/hive-agent-text-context'
import type { HiveAgentBinding } from '../../shared/hive-agent-session-schema'
import type { HiveAiModelSelection } from '../../shared/hive-ai-model-catalog'
import type { HiveAgentTextExecutionBinding } from '../../shared/hive-agent-text-pack'

export type HiveAgentTextEvent = { sequence: number } & (
  | { type: 'text'; text: string }
  | { type: 'completed' | 'failed' }
)

/** P2 text execution port; owns no process lease, journal, credential discovery or retries. */
export type HiveAgentTextAdapter = {
  binding(sessionId: string): HiveAgentBinding
  acquireExecution?(input: {
    sessionId: string
    generationId: string
    signal: AbortSignal
  }): Promise<{ fence: number; assertCurrent: () => void }>
  run(input: {
    sessionId: string
    generationId: string
    modelSelection: Readonly<HiveAiModelSelection>
    executionBinding: Readonly<HiveAgentTextExecutionBinding>
    text: string
    history: readonly HiveAgentContextMessage[]
    signal: AbortSignal
  }): AsyncIterable<HiveAgentTextEvent>
}
