import type { HiveAgentBinding } from '../../shared/hive-agent-session-schema'

export type HiveAgentTextEvent = { sequence: number } & (
  | { type: 'text'; text: string }
  | { type: 'completed' | 'failed' }
)

/** P2 text execution port; owns no process lease, journal, credential discovery or retries. */
export type HiveAgentTextAdapter = {
  binding(sessionId: string): HiveAgentBinding
  run(input: {
    sessionId: string
    generationId: string
    text: string
    signal: AbortSignal
  }): AsyncIterable<HiveAgentTextEvent>
}
