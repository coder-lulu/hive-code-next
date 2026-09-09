import { readHiveAgentJournal } from './hive-agent-journal-reference'
import { HiveAgentSubscriptionScope } from './hive-agent-subscription-scope'
import {
  HIVE_AGENT_METHODS,
  hiveAgentMethodSchemas,
  type AuthenticatedRuntimePrincipal,
  type HiveAgentMethod
} from '../../shared/hive-agent-session-methods'
import {
  HIVE_AGENT_SESSION_ERROR_CODES,
  hiveAgentBindingSchema
} from '../../shared/hive-agent-session-schema'
import {
  hiveAgentSessionEntrySchema,
  type HiveAgentSessionEntry
} from '../../shared/hive-agent-session-entry'
import { computeAgentSessionPayloadFingerprint } from '../../shared/agent-session-mutation-envelope'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import type { AgentSessionOperationDecision } from '../../shared/agent-session-operation-ledger'
import type { AgentSessionJournal } from './agent-session-journal/journal-store'
import type { HiveAgentTextAdapter } from './hive-agent-text-adapter'
import { authorizeHiveAgentMethod } from './hive-agent-session-authorization'
import { readAgentSessionHistory } from './agent-session-wire/agent-session-history-page'
import {
  AgentSessionSubscribers,
  type AgentSessionSubscriberEmit
} from './agent-session-wire/structured-agent-session-subscribers'
import { HiveAgentSessionTurns } from './hive-agent-session-turns'
import { recoverHiveAgentSessions } from './hive-agent-session-recovery'

export type HiveAgentHostDependencies = {
  store: AgentSessionRecordStore
  runtimeRecordId: string
  adapter?: HiveAgentTextAdapter
  journalFor: (entry: HiveAgentSessionEntry) => Promise<AgentSessionJournal>
  fenceFor: (entry: HiveAgentSessionEntry) => number
  now: () => number
  eligibilityRevision: () => number
  enabled: () => boolean
  hasSecretReference?: (reference: string) => boolean
}
export type HiveAgentPrincipalResolver = () => AuthenticatedRuntimePrincipal | null

export class HiveAgentSessionHost {
  private readonly subscribers = new AgentSessionSubscribers()
  private readonly turns: HiveAgentSessionTurns
  private readonly subscriptionScope: HiveAgentSubscriptionScope
  private closed = false
  private constructor(private readonly deps: HiveAgentHostDependencies) {
    this.turns = new HiveAgentSessionTurns(
      deps,
      this.subscribers,
      this.authorize.bind(this),
      this.operation.bind(this),
      this.receipt.bind(this)
    )
    this.subscriptionScope = new HiveAgentSubscriptionScope(
      deps,
      this.subscribers,
      this.authorize.bind(this)
    )
  }

  static async open(deps: HiveAgentHostDependencies): Promise<HiveAgentSessionHost> {
    await recoverHiveAgentSessions(deps)
    return new HiveAgentSessionHost(deps)
  }

  private authorize(
    method: string,
    resolve: HiveAgentPrincipalResolver,
    entry?: HiveAgentSessionEntry | null
  ) {
    return authorizeHiveAgentMethod({
      method,
      principal: resolve(),
      entry,
      runtimeRecordId: this.deps.runtimeRecordId,
      now: this.deps.now(),
      eligibilityRevision: this.deps.eligibilityRevision()
    })
  }

  async call(method: string, raw: unknown, resolve: HiveAgentPrincipalResolver): Promise<unknown> {
    try {
      if (this.closed) {
        throw new Error('hive_agent_capability_unavailable')
      }
      const principal = this.authorize(method, resolve)
      const metadata = HIVE_AGENT_METHODS[method as HiveAgentMethod]
      const parsed = metadata.schema.safeParse(raw)
      if (!parsed.success) {
        throw new Error('hive_agent_invalid_request')
      }
      const params = parsed.data as { sessionId: string; operationId?: string }
      const entry = this.deps.store.hive.get(params.sessionId)
      this.authorize(method, resolve, entry)
      if (method !== 'hiveAgent.create' && !entry) {
        throw new Error('hive_agent_forbidden')
      }
      if (method === 'hiveAgent.create') {
        return await this.create(raw, principal)
      }
      if (!entry) {
        throw new Error('hive_agent_forbidden')
      }
      if (method === 'hiveAgent.submit') {
        return await this.turns.submit(raw, entry, resolve)
      }
      if (method === 'hiveAgent.cancel') {
        return await this.turns.cancel(raw, entry, principal)
      }
      if (method === 'hiveAgent.delete') {
        return await this.delete(raw, entry, principal)
      }
      if (method === 'hiveAgent.read') {
        return { ok: true, value: this.publicAggregate(entry) }
      }
      if (method === 'hiveAgent.binding') {
        return { ok: true, value: this.publicAggregate(entry).binding ?? null }
      }
      if (method === 'hiveAgent.history' || method === 'hiveAgent.export') {
        const journal = await readHiveAgentJournal(this.deps, entry)
        this.authorize(method, resolve, this.deps.store.hive.get(params.sessionId))
        const options = hiveAgentMethodSchemas[method].parse(raw)
        const history = readAgentSessionHistory(journal, {
          sessionId: params.sessionId,
          direction: options.direction ?? (options.cursor ? 'before' : 'tail'),
          cursor: options.cursor,
          limit: options.limit
        })
        return {
          ok: true,
          value: { ...history, page: { ...history.page, sessionId: params.sessionId } }
        }
      }
      // Deletion and subscription have explicit resource-lifecycle entry points.
      throw new Error('hive_agent_capability_unavailable')
    } catch (error) {
      const code =
        error instanceof Error &&
        HIVE_AGENT_SESSION_ERROR_CODES.some((value) => value === error.message)
          ? error.message
          : 'hive_agent_outcome_unknown'
      return { ok: false, error: { code } }
    }
  }

  private publicAggregate(entry: HiveAgentSessionEntry) {
    const aggregate = structuredClone(entry.aggregate)
    if (aggregate.binding) {
      delete aggregate.binding.encryptedSecretRef
    }
    return aggregate
  }

  private operation(
    method: string,
    params: { sessionId: string; operationId: string },
    principal: AuthenticatedRuntimePrincipal,
    fields: Record<string, unknown>
  ) {
    return {
      callerKey: JSON.stringify(['hive-agent', principal.accountId, principal.deviceId]),
      operationId: params.operationId,
      fingerprint: computeAgentSessionPayloadFingerprint({
        method,
        sessionId: params.sessionId,
        fields
      }),
      now: this.deps.now()
    }
  }

  private receipt(decision: AgentSessionOperationDecision, sessionId: string) {
    if (decision.decision === 'refused') {
      throw new Error(
        decision.code === 'agent_session_operation_conflict'
          ? 'hive_agent_operation_conflict'
          : 'hive_agent_invalid_request'
      )
    }
    return {
      ok: true,
      value: {
        sessionId,
        operationId: decision.row.operationId,
        status: decision.row.outcome.status,
        replayed: decision.decision === 'replay'
      }
    }
  }

  private async create(raw: unknown, principal: AuthenticatedRuntimePrincipal) {
    const params = hiveAgentMethodSchemas['hiveAgent.create'].parse(raw)
    if (!this.deps.enabled() || !this.deps.adapter) {
      throw new Error('hive_agent_capability_unavailable')
    }
    const binding = hiveAgentBindingSchema.parse(this.deps.adapter.binding(params.sessionId))
    if (binding.encryptedSecretRef && !this.deps.hasSecretReference?.(binding.encryptedSecretRef)) {
      throw new Error('hive_agent_forbidden')
    }
    const now = this.deps.now()
    const entry = hiveAgentSessionEntrySchema.parse({
      accountId: principal.accountId,
      deviceId: principal.deviceId,
      projectScope: principal.projectScope,
      aggregate: {
        session: {
          schemaVersion: 1,
          sessionId: params.sessionId,
          profileId: params.profileId,
          createdAt: now,
          updatedAt: now,
          visibility: 'private',
          retention: 'until-deleted',
          backendBindingRef: binding.bindingId,
          stateRevision: 0
        },
        binding
      }
    })
    const decision = await this.deps.store.hive.commit({
      operation: this.operation('hiveAgent.create', params, principal, {
        profileId: params.profileId
      }),
      entry,
      expectedRevision: null
    })
    return this.receipt(decision, params.sessionId)
  }

  private async delete(
    raw: unknown,
    entry: HiveAgentSessionEntry,
    principal: AuthenticatedRuntimePrincipal
  ) {
    const params = hiveAgentMethodSchemas['hiveAgent.delete'].parse(raw)
    const operation = this.operation('hiveAgent.delete', params, principal, {})
    const existing = this.deps.store
      .listOperationRows()
      .find(
        (row) => row.callerKey === operation.callerKey && row.operationId === operation.operationId
      )
    if (existing && existing.fingerprint !== operation.fingerprint) {
      throw new Error('hive_agent_operation_conflict')
    }
    if (existing?.outcome.status === 'succeeded') {
      return this.receipt({ decision: 'replay', row: existing }, params.sessionId)
    }
    if (
      entry.aggregate.binding?.providerKind !== 'managed-pi' ||
      this.turns.isActive(params.sessionId) ||
      ['RUNNING', 'PENDING', 'UNKNOWN'].includes(entry.aggregate.generation?.state ?? '')
    ) {
      throw new Error('hive_agent_capability_unavailable')
    }
    if (entry.deletedAt === undefined) {
      const now = this.deps.now()
      const decision = await this.deps.store.hive.commit({
        operation,
        entry: {
          ...entry,
          deletedAt: now,
          deleteOperationId: params.operationId,
          aggregate: {
            ...entry.aggregate,
            session: {
              ...entry.aggregate.session,
              updatedAt: now,
              stateRevision: entry.aggregate.session.stateRevision + 1
            }
          }
        },
        expectedRevision: entry.aggregate.session.stateRevision,
        pending: true
      })
      if (decision.decision !== 'admit') {
        return this.receipt(decision, params.sessionId)
      }
    } else if (entry.deleteOperationId !== params.operationId) {
      throw new Error('hive_agent_operation_conflict')
    }
    const journal = await readHiveAgentJournal(this.deps, entry)
    await journal.purgeContent(this.deps.fenceFor(entry))
    await this.deps.store.hive.completeDeletion(params.sessionId, params.operationId)
    this.subscribers.publish(params.sessionId, journal)
    return {
      ok: true,
      value: {
        sessionId: params.sessionId,
        operationId: params.operationId,
        status: 'succeeded',
        replayed: !!existing
      }
    }
  }

  subscribe = (
    raw: unknown,
    resolve: HiveAgentPrincipalResolver,
    emit: AgentSessionSubscriberEmit
  ) => this.subscriptionScope.open(raw, resolve, emit)

  async drain(): Promise<void> {
    await this.turns.drain()
  }
  async close(): Promise<void> {
    this.closed = true
    this.subscriptionScope.close()
    await this.turns.close()
  }
}
