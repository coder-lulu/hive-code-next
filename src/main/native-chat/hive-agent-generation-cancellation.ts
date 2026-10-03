import type { AuthenticatedRuntimePrincipal } from '../../shared/hive-agent-session-methods'
import { hiveAgentMethodSchemas } from '../../shared/hive-agent-session-methods'
import {
  hiveAgentSessionEntrySchema,
  type HiveAgentSessionEntry
} from '../../shared/hive-agent-session-entry'
import type {
  HiveAgentHostDependencies,
  HiveAgentOperationFactory,
  HiveAgentOperationReceipt
} from './hive-agent-session-dependencies'

export async function cancelHiveAgentGeneration(input: {
  raw: unknown
  entry: HiveAgentSessionEntry
  principal: AuthenticatedRuntimePrincipal
  deps: HiveAgentHostDependencies
  operation: HiveAgentOperationFactory
  receipt: HiveAgentOperationReceipt
  isActive: (sessionId: string) => boolean
  abort: (sessionId: string) => void
}) {
  const { entry, principal, deps } = input
  const params = hiveAgentMethodSchemas['hiveAgent.cancel'].parse(input.raw)
  const generation = entry.aggregate.generation
  const operation = input.operation('hiveAgent.cancel', params, principal, {
    generationId: params.generationId
  })
  const existing = deps.store
    .listOperationRows()
    .find(
      (row) => row.callerKey === operation.callerKey && row.operationId === operation.operationId
    )
  if (existing) {
    if (existing.fingerprint !== operation.fingerprint) {
      throw new Error('hive_agent_operation_conflict')
    }
    return input.receipt({ decision: 'replay', row: existing }, params.sessionId)
  }
  if (generation?.generationId !== params.generationId || !entry.aggregate.turn) {
    throw new Error('hive_agent_stale_generation')
  }
  if (
    generation.state === 'UNKNOWN' ||
    (generation.state === 'RUNNING' && !input.isActive(params.sessionId))
  ) {
    throw new Error('hive_agent_outcome_unknown')
  }
  const now = deps.now()
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
  const decision = await deps.store.hive.commit({
    operation,
    entry: next,
    expectedRevision: entry.aggregate.session.stateRevision,
    settleCurrentTurn: true,
    pending: !terminal && !!deps.cancelExecution
  })
  if (decision.decision === 'admit') {
    input.abort(params.sessionId)
    if (!terminal && deps.cancelExecution) {
      let status: 'succeeded' | 'unknown' = 'unknown'
      try {
        await deps.cancelExecution(next)
        status = 'succeeded'
      } catch {
        // A lost remote acknowledgement never authorizes a second cancellation POST.
      }
      const settled = await deps.store.hive.settleCancellation(
        params.sessionId,
        params.generationId,
        operation,
        status
      )
      return input.receipt(settled, params.sessionId)
    }
  }
  return input.receipt(decision, params.sessionId)
}
