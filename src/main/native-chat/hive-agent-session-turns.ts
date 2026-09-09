import { readHiveAgentJournal } from './hive-agent-journal-reference'
import { randomUUID } from 'node:crypto'
import {
  hiveAgentMethodSchemas,
  type AuthenticatedRuntimePrincipal
} from '../../shared/hive-agent-session-methods'
import {
  hiveAgentSessionEntrySchema,
  type HiveAgentSessionEntry
} from '../../shared/hive-agent-session-entry'
import type { AgentSessionOperationAdmission } from '../runtime/agent-session-operation-admission'
import type { AgentSessionOperationDecision } from '../../shared/agent-session-operation-ledger'
import type { AgentSessionSubscribers } from './agent-session-wire/structured-agent-session-subscribers'
import type {
  HiveAgentHostDependencies,
  HiveAgentPrincipalResolver
} from './hive-agent-session-host'
import { runHiveAgentGeneration } from './hive-agent-generation-runner'

export class HiveAgentSessionTurns {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>()
  private starting = 0
  private closed = false
  constructor(
    private readonly deps: HiveAgentHostDependencies,
    private readonly subscribers: AgentSessionSubscribers,
    private readonly authorize: (
      method: string,
      resolve: HiveAgentPrincipalResolver,
      entry?: HiveAgentSessionEntry | null
    ) => AuthenticatedRuntimePrincipal,
    private readonly operation: (
      method: string,
      params: { sessionId: string; operationId: string },
      principal: AuthenticatedRuntimePrincipal,
      fields: Record<string, unknown>
    ) => AgentSessionOperationAdmission,
    private readonly receipt: (
      decision: AgentSessionOperationDecision,
      sessionId: string
    ) => unknown
  ) {}
  isActive = (id: string) => this.active.has(id)
  async submit(raw: unknown, entry: HiveAgentSessionEntry, resolve: HiveAgentPrincipalResolver) {
    if (this.closed) {
      throw new Error('hive_agent_capability_unavailable')
    }
    const params = hiveAgentMethodSchemas['hiveAgent.submit'].parse(raw)
    const principal = this.authorize('hiveAgent.submit', resolve, entry)
    const operation = this.operation('hiveAgent.submit', params, principal, { text: params.text })
    const existing = this.deps.store
      .listOperationRows()
      .find(
        (row) => row.callerKey === operation.callerKey && row.operationId === operation.operationId
      )
    if (existing) {
      if (existing.fingerprint !== operation.fingerprint) {
        throw new Error('hive_agent_operation_conflict')
      }
      return this.receipt({ decision: 'replay', row: existing }, params.sessionId)
    }
    if (
      !this.deps.enabled() ||
      !this.deps.adapter ||
      entry.aggregate.binding?.providerKind !== 'managed-pi' ||
      !entry.aggregate.binding.capabilities.includes('local.text')
    ) {
      throw new Error('hive_agent_capability_unavailable')
    }
    if (
      this.active.has(params.sessionId) ||
      this.active.size + this.starting >= 5 ||
      ['RUNNING', 'PENDING', 'UNKNOWN'].includes(entry.aggregate.generation?.state ?? '')
    ) {
      throw new Error('hive_agent_outcome_unknown')
    }
    this.starting += 1
    try {
      const now = this.deps.now()
      const turnId = `ha-turn:${randomUUID()}`
      const generationId = `ha-generation:${randomUUID()}`
      const next = hiveAgentSessionEntrySchema.parse({
        ...entry,
        aggregate: {
          ...entry.aggregate,
          session: {
            ...entry.aggregate.session,
            activeGenerationId: generationId,
            stateRevision: entry.aggregate.session.stateRevision + 1,
            updatedAt: now
          },
          turn: {
            schemaVersion: 1,
            turnId,
            sessionId: params.sessionId,
            clientOperationId: params.operationId,
            inputRef: params.operationId,
            state: 'RUNNING',
            createdAt: now
          },
          generation: {
            schemaVersion: 1,
            generationId,
            turnId,
            providerBindingRef: entry.aggregate.binding.bindingId,
            capabilityRevision: entry.aggregate.binding.capabilityRevision,
            state: 'RUNNING'
          }
        }
      })
      const journal = await readHiveAgentJournal(this.deps, entry)
      this.authorize('hiveAgent.submit', resolve, entry)
      const decision = await this.deps.store.hive.commit({
        operation,
        entry: next,
        expectedRevision: entry.aggregate.session.stateRevision,
        pending: true
      })
      if (decision.decision !== 'admit') {
        return this.receipt(decision, params.sessionId)
      }
      const controller = new AbortController()
      const done = runHiveAgentGeneration({
        entry: next,
        store: this.deps.store,
        journal,
        adapter: this.deps.adapter,
        callerKey: operation.callerKey,
        text: params.text,
        fingerprint: operation.fingerprint,
        fence: this.deps.fenceFor(next),
        signal: controller.signal,
        now: this.deps.now,
        authorize: () => {
          if (this.closed || !this.deps.enabled()) {
            throw new Error('hive_agent_capability_unavailable')
          }
          this.authorize('hiveAgent.submit', resolve, next)
        },
        publish: () => this.subscribers.publish(params.sessionId, journal)
      })
        .catch(() => undefined)
        .finally(() => {
          if (this.active.get(params.sessionId)?.controller === controller) {
            this.active.delete(params.sessionId)
          }
        })
      this.active.set(params.sessionId, { controller, done })
      return this.receipt(decision, params.sessionId)
    } finally {
      this.starting -= 1
    }
  }

  async cancel(
    raw: unknown,
    entry: HiveAgentSessionEntry,
    principal: AuthenticatedRuntimePrincipal
  ) {
    const params = hiveAgentMethodSchemas['hiveAgent.cancel'].parse(raw)
    const generation = entry.aggregate.generation
    const operation = this.operation('hiveAgent.cancel', params, principal, {
      generationId: params.generationId
    })
    const existing = this.deps.store
      .listOperationRows()
      .find(
        (row) => row.callerKey === operation.callerKey && row.operationId === operation.operationId
      )
    if (existing) {
      if (existing.fingerprint !== operation.fingerprint) {
        throw new Error('hive_agent_operation_conflict')
      }
      return this.receipt({ decision: 'replay', row: existing }, params.sessionId)
    }
    if (generation?.generationId !== params.generationId || !entry.aggregate.turn) {
      throw new Error('hive_agent_stale_generation')
    }
    if (
      generation.state === 'UNKNOWN' ||
      (generation.state === 'RUNNING' && !this.active.has(params.sessionId))
    ) {
      throw new Error('hive_agent_outcome_unknown')
    }
    const now = this.deps.now()
    const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(generation.state)
    const next = hiveAgentSessionEntrySchema.parse({
      ...entry,
      aggregate: {
        ...entry.aggregate,
        session: {
          ...entry.aggregate.session,
          updatedAt: now,
          stateRevision: entry.aggregate.session.stateRevision + 1
        },
        turn: {
          ...entry.aggregate.turn,
          ...(terminal ? {} : { state: 'CANCELLED', finalizedAt: now })
        },
        generation: {
          ...generation,
          ...(terminal ? {} : { state: 'CANCELLED', finalReceiptRef: params.operationId })
        }
      }
    })
    const decision = await this.deps.store.hive.commit({
      operation,
      entry: next,
      expectedRevision: entry.aggregate.session.stateRevision,
      settleCurrentTurn: true
    })
    if (decision.decision === 'admit') {
      this.active.get(params.sessionId)?.controller.abort()
    }
    return this.receipt(decision, params.sessionId)
  }

  async drain(): Promise<void> {
    await Promise.all([...this.active.values()].map((value) => value.done))
  }
  async close(): Promise<void> {
    this.closed = true
    for (const value of this.active.values()) {
      value.controller.abort()
    }
    await this.drain()
  }
}
