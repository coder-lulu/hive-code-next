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
import type { AgentSessionSubscribers } from './agent-session-wire/structured-agent-session-subscribers'
import type {
  HiveAgentHostDependencies,
  HiveAgentOperationFactory,
  HiveAgentOperationReceipt,
  HiveAgentPrincipalResolver
} from './hive-agent-session-dependencies'
import { runHiveAgentGeneration } from './hive-agent-generation-runner'
import { hiveAiModelSelectionCommandSchema } from '../../shared/hive-ai-model-catalog'
import type { HiveAiModelResolution } from '../hive-runtime-cloud/hive-ai-model-reader'
import { resolveHiveAgentTextPack } from './hive-agent-text-pack'
import { cancelHiveAgentGeneration } from './hive-agent-generation-cancellation'

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
    private readonly operation: HiveAgentOperationFactory,
    private readonly receipt: HiveAgentOperationReceipt
  ) {}
  isActive = (id: string) => this.active.has(id)
  async submit(raw: unknown, entry: HiveAgentSessionEntry, resolve: HiveAgentPrincipalResolver) {
    const params = hiveAgentMethodSchemas['hiveAgent.submit'].parse(raw)
    const principal = this.authorize('hiveAgent.submit', resolve, entry)
    const modelSelection = Object.freeze({ ...params.modelSelection })
    const operation = this.operation('hiveAgent.submit', params, principal, {
      text: params.text,
      modelSelection
    })
    const replay = () => {
      if (this.closed) {
        throw new Error('hive_agent_capability_unavailable')
      }
      this.authorize(
        'hiveAgent.submit',
        resolve,
        this.deps.store.hive.get(params.sessionId) ?? entry
      )
      const existing = this.deps.store
        .listOperationRows()
        .find(
          (row) =>
            row.callerKey === operation.callerKey && row.operationId === operation.operationId
        )
      if (!existing) {
        return null
      }
      if (existing.fingerprint !== operation.fingerprint) {
        throw new Error('hive_agent_operation_conflict')
      }
      return this.receipt({ decision: 'replay', row: existing }, params.sessionId)
    }
    const recorded = replay()
    if (recorded !== null) {
      return recorded
    }
    const adapter = this.deps.adapter
    const resolveModel = this.deps.resolveModel
    const readPack = this.deps.readPack
    if (
      !this.deps.enabled() ||
      !adapter ||
      !resolveModel ||
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
      const pack = resolveHiveAgentTextPack(
        readPack,
        entry.aggregate.session.profileId,
        modelSelection.protocol
      )
      let model: HiveAiModelResolution
      try {
        model = await resolveModel(modelSelection, principal)
        const resolved = hiveAiModelSelectionCommandSchema.parse(model.selection)
        if (JSON.stringify(resolved) !== JSON.stringify(modelSelection)) {
          throw new Error('different model selection')
        }
      } catch {
        const recorded = replay()
        if (recorded !== null) {
          return recorded
        }
        throw new Error('hive_agent_model_unavailable')
      }
      const recorded = replay()
      if (recorded !== null) {
        return recorded
      }
      const assertCurrent = () => {
        if (
          this.closed ||
          !this.deps.enabled() ||
          this.deps.adapter !== adapter ||
          this.deps.resolveModel !== resolveModel
        ) {
          throw new Error('hive_agent_capability_unavailable')
        }
        this.authorize(
          'hiveAgent.submit',
          resolve,
          this.deps.store.hive.get(params.sessionId) ?? entry
        )
        if (this.deps.readPack !== readPack) {
          throw new Error('hive_agent_pack_unavailable')
        }
        pack.assertCurrent()
        try {
          model.assertCurrent()
        } catch {
          throw new Error('hive_agent_model_unavailable')
        }
      }
      assertCurrent()
      if (
        this.active.has(params.sessionId) ||
        ['PENDING', 'RUNNING', 'UNKNOWN'].includes(
          this.deps.store.hive.get(params.sessionId)?.aggregate.generation?.state ?? ''
        )
      ) {
        throw new Error('hive_agent_outcome_unknown')
      }
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
            modelSelection,
            executionBinding: pack.binding,
            state: 'RUNNING'
          }
        }
      })
      const journal = await readHiveAgentJournal(this.deps, entry)
      const recordedAfterJournal = replay()
      if (recordedAfterJournal !== null) {
        return recordedAfterJournal
      }
      assertCurrent()
      const decision = await this.deps.store.hive.commit({
        operation,
        entry: next,
        expectedRevision: entry.aggregate.session.stateRevision,
        pending: true,
        validate: assertCurrent
      })
      if (decision.decision !== 'admit') {
        return replay() ?? this.receipt(decision, params.sessionId)
      }
      const controller = new AbortController()
      const done = runHiveAgentGeneration({
        entry: next,
        store: this.deps.store,
        journal,
        adapter,
        callerKey: operation.callerKey,
        text: params.text,
        fingerprint: operation.fingerprint,
        fence: this.deps.fenceFor(next),
        signal: controller.signal,
        now: this.deps.now,
        authorize: assertCurrent,
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
    return cancelHiveAgentGeneration({
      raw,
      entry,
      principal,
      deps: this.deps,
      operation: this.operation,
      receipt: this.receipt,
      isActive: this.isActive,
      abort: (id) => this.active.get(id)?.controller.abort()
    })
  }

  async waitForCancelledCleanup(sessionId: string): Promise<void> {
    const active = this.active.get(sessionId)
    if (active?.controller.signal.aborted) {
      await active.done
    }
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
