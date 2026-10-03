import {
  hiveAgentSessionEntrySchema,
  type HiveAgentSessionEntry
} from '../../shared/hive-agent-session-entry'
import {
  settleAgentSessionOperation,
  type AgentSessionOperationOutcome
} from '../../shared/agent-session-operation-ledger'
import {
  admitAgentSessionOperationRow,
  type AgentSessionOperationAdmission
} from './agent-session-operation-admission'
import type { AgentSessionStoreState } from './agent-session-record-store-file'
import { parseAgentSessionOperationTimestamp } from '../../shared/agent-session-host-authority'
import type { AgentSessionStoreTransactionQueue } from './agent-session-store-transaction-queue'

/** Scoped access to the SAME transaction queue, state and ledger as runtime records. */
export class HiveAgentSessionPersistence {
  constructor(private readonly transactions: AgentSessionStoreTransactionQueue) {}
  settleCancellation(
    sessionId: string,
    generationId: string,
    operation: AgentSessionOperationAdmission,
    status: 'succeeded' | 'unknown'
  ) {
    return this.transactions.transact(() => {
      const state = this.transactions.state
      const entry = state.hiveSessions?.get(sessionId)
      const row = [...state.operations.values()].find(
        (value) =>
          value.callerKey === operation.callerKey && value.operationId === operation.operationId
      )
      if (
        !entry ||
        entry.deletedAt !== undefined ||
        entry.aggregate.generation?.generationId !== generationId ||
        operation.callerKey !== JSON.stringify(['hive-agent', entry.accountId, entry.deviceId]) ||
        !row ||
        row.fingerprint !== operation.fingerprint ||
        row.outcome.status !== 'pending'
      ) {
        throw new Error('hive_agent_operation_conflict')
      }
      const outcome: AgentSessionOperationOutcome =
        status === 'succeeded' ? { status, sessionId } : { status }
      state.operations = settleAgentSessionOperation(state.operations, { ...operation, outcome })
      return { decision: 'admit' as const, row: { ...row, outcome } }
    })
  }
  completeDeletion(sessionId: string, operationId: string): Promise<void> {
    return this.transactions.transact(() => {
      const state = this.transactions.state
      const entry = state.hiveSessions?.get(sessionId)
      if (!entry || entry.deletedAt === undefined || entry.deleteOperationId !== operationId) {
        throw new Error('hive_agent_operation_conflict')
      }
      const session = { ...entry.aggregate.session }
      delete session.activeGenerationId
      delete session.backendBindingRef
      state.hiveSessions!.set(sessionId, {
        ...entry,
        aggregate: { session },
        deletionComplete: true
      })
      state.operations = settleAgentSessionOperation(state.operations, {
        callerKey: JSON.stringify(['hive-agent', entry.accountId, entry.deviceId]),
        operationId,
        outcome: { status: 'succeeded', sessionId }
      })
    })
  }
  get = (sessionId: string) =>
    structuredClone(this.transactions.state.hiveSessions?.get(sessionId) ?? null)
  list = () => structuredClone([...(this.transactions.state.hiveSessions?.values() ?? [])])
  commit = (input: HiveSessionCommit) =>
    this.transactions.transact(() => commitHiveSession(this.transactions.state, input))
  settle = (input: Parameters<typeof settleHiveSession>[1]) =>
    this.transactions.transact(() => settleHiveSession(this.transactions.state, input))
}

export type HiveSessionCommit = {
  operation: AgentSessionOperationAdmission
  entry: HiveAgentSessionEntry
  expectedRevision: number | null
  pending?: boolean
  settleCurrentTurn?: boolean
  validate?: () => void
}

export function commitHiveSession(state: AgentSessionStoreState, input: HiveSessionCommit) {
  const entry = hiveAgentSessionEntrySchema.parse(input.entry)
  const id = entry.aggregate.session.sessionId
  if (
    state.hiveRecoveryFenceAt !== undefined &&
    (parseAgentSessionOperationTimestamp(input.operation.operationId) ?? 0) <=
      state.hiveRecoveryFenceAt
  ) {
    throw new Error('hive_agent_outcome_unknown')
  }
  const admitted = admitAgentSessionOperationRow(state.operations, input.operation)
  if (admitted.decision.decision !== 'admit') {
    return admitted.decision
  }
  const current = state.hiveSessions?.get(id)
  if (
    (current?.aggregate.session.stateRevision ?? null) !== input.expectedRevision ||
    current?.deletedAt !== undefined
  ) {
    throw new Error('hive_agent_operation_conflict')
  }
  if (entry.aggregate.session.stateRevision !== (input.expectedRevision ?? -1) + 1) {
    throw new Error('hive_agent_operation_conflict')
  }
  if (
    current &&
    (current.accountId !== entry.accountId ||
      current.deviceId !== entry.deviceId ||
      current.projectScope !== entry.projectScope)
  ) {
    throw new Error('hive_agent_forbidden')
  }
  input.validate?.()
  state.hiveSessions ??= new Map()
  state.hiveSessions.set(id, entry)
  state.operations = admitted.rows
  const outcome: AgentSessionOperationOutcome = input.pending
    ? { status: 'pending' }
    : { status: 'succeeded', sessionId: id }
  state.operations = settleAgentSessionOperation(state.operations, { ...input.operation, outcome })
  if (input.settleCurrentTurn && current?.aggregate.turn) {
    state.operations = settleAgentSessionOperation(state.operations, {
      callerKey: input.operation.callerKey,
      operationId: current.aggregate.turn.clientOperationId,
      outcome: { status: 'succeeded', sessionId: id }
    })
  }
  return { decision: 'admit' as const, row: { ...admitted.decision.row, outcome } }
}

/** Host settlement of the already admitted turn, never a new dispatch authorization. */
export function settleHiveSession(
  state: AgentSessionStoreState,
  input: {
    sessionId: string
    generationId: string
    callerKey: string
    operationId: string
    state: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN'
    now: number
  }
) {
  const entry = state.hiveSessions?.get(input.sessionId)
  const generation = entry?.aggregate.generation
  const turn = entry?.aggregate.turn
  if (
    !entry ||
    entry.deletedAt !== undefined ||
    !generation ||
    !turn ||
    generation.generationId !== input.generationId
  ) {
    return false
  }
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(generation.state)) {
    return false
  }
  if (
    input.callerKey !== JSON.stringify(['hive-agent', entry.accountId, entry.deviceId]) ||
    turn.clientOperationId !== input.operationId
  ) {
    return false
  }
  if (input.state === 'UNKNOWN' && generation.state === 'UNKNOWN') {
    return false
  }
  const terminal = input.state !== 'UNKNOWN'
  const next = hiveAgentSessionEntrySchema.parse({
    ...entry,
    aggregate: {
      ...entry.aggregate,
      session: {
        ...entry.aggregate.session,
        stateRevision: entry.aggregate.session.stateRevision + 1,
        updatedAt: input.now
      },
      turn: { ...turn, state: input.state, ...(terminal ? { finalizedAt: input.now } : {}) },
      generation: {
        ...generation,
        state: input.state,
        ...(terminal ? { finalReceiptRef: input.operationId } : {})
      }
    }
  })
  state.hiveSessions!.set(input.sessionId, next)
  state.operations = settleAgentSessionOperation(state.operations, {
    callerKey: input.callerKey,
    operationId: input.operationId,
    outcome: terminal ? { status: 'succeeded', sessionId: input.sessionId } : { status: 'unknown' }
  })
  return true
}
