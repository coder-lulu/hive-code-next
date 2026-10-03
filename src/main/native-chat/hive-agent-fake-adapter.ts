import { randomUUID } from 'node:crypto'
import { hiveAgentBindingSchema } from '../../shared/hive-agent-session-schema'
import type { HiveAgentTextAdapter, HiveAgentTextEvent } from './hive-agent-text-adapter'

/** Explicit test/development injection only; never installed as a production fallback. */
export class HiveAgentFakeAdapter implements HiveAgentTextAdapter {
  dispatches = 0
  constructor(
    private readonly scenario: {
      events?: HiveAgentTextEvent[]
      wait?: (signal: AbortSignal) => Promise<void>
      crash?: boolean
    } = {}
  ) {}
  binding(sessionId: string) {
    return hiveAgentBindingSchema.parse({
      schemaVersion: 1,
      bindingId: `ha-binding:${randomUUID()}`,
      providerKind: 'managed-pi',
      providerSessionRef: sessionId,
      runtimeRecordRef: `fixture_${randomUUID()}`,
      capabilityRevision: 1,
      capabilities: ['local.text']
    })
  }
  async *run(input: Parameters<HiveAgentTextAdapter['run']>[0]): AsyncIterable<HiveAgentTextEvent> {
    this.dispatches += 1
    await this.scenario.wait?.(input.signal)
    if (input.signal.aborted) {
      return
    }
    if (this.scenario.crash) {
      throw new Error('fixture crash')
    }
    for (const event of this.scenario.events ?? [
      { sequence: 1, type: 'text', text: 'Fake response' },
      { sequence: 2, type: 'completed' }
    ]) {
      if (input.signal.aborted) {
        return
      }
      yield event
    }
  }
}
