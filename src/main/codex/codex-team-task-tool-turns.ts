import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import { readAgentJournalTurn } from '../../shared/agent-session-turn-record'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { codexTurnLifecycleIdentity } from './codex-structured-journal-translation-turns'
import type { CodexStructuredSessionEvent } from './codex-structured-session-state'
import { readCodexThreadId, readCodexTurnId } from './codex-structured-thread-facts'

export class CodexTeamTaskToolTurns {
  private readonly active = new Map<string, Set<string>>()
  private readonly pendingRetirements = new Set<string>()
  private starting: { turnId: string; allowed: boolean } | null = null

  constructor(
    private readonly sink: StructuredAgentSessionEventSink | undefined,
    private readonly sessionId: string,
    private readonly threadId: string
  ) {}

  private lifecycle(turnId: string) {
    const body = this.sink
      ?.journalLinkage?.()
      ?.itemBody(agentJournalItemKey(codexTurnLifecycleIdentity(this.sessionId, turnId)))
    return readAgentJournalTurn(body ?? undefined)
  }

  private retireWritten(): void {
    for (const id of this.pendingRetirements) {
      const state = this.lifecycle(id)?.state
      if (state && state !== 'running') {
        this.pendingRetirements.delete(id)
      }
    }
  }

  observe(event: CodexStructuredSessionEvent, admitted: boolean): boolean {
    if (event.type !== 'notification' || readCodexThreadId(event.params) !== this.threadId) {
      return true
    }
    const turnId = readCodexTurnId(event.params)
    if (!turnId) {
      return true
    }
    if (!admitted) {
      this.retireWritten()
      if (event.method === 'turn/completed') {
        if (this.active.has(turnId)) {
          this.revoke(turnId)
        }
      }
      if (event.method === 'turn/started') {
        const state = this.lifecycle(turnId)?.state
        const allowed = !state || state === 'running'
        this.starting = { turnId, allowed }
        // A replay must not turn a durable terminal row back into a running row.
        if (!allowed) {
          return false
        }
      }
      return true
    }
    if (
      event.method === 'turn/started' &&
      this.starting?.turnId === turnId &&
      this.starting.allowed &&
      !this.pendingRetirements.has(turnId) &&
      this.pendingRetirements.size < 256 &&
      !this.active.has(turnId) &&
      this.active.size < 4
    ) {
      this.active.set(turnId, new Set())
    }
    this.starting = null
    return true
  }

  revoke(turnId?: string): void {
    this.retireWritten()
    for (const id of turnId ? [turnId] : this.active.keys()) {
      if (this.pendingRetirements.size < 256 || this.active.has(id)) {
        this.pendingRetirements.add(id)
      }
      this.active.delete(id)
    }
  }

  calls(turnId: string): Set<string> | undefined {
    return this.active.get(turnId)
  }

  isDurablyRunning(turnId: string): boolean {
    return this.lifecycle(turnId)?.state === 'running'
  }
}
