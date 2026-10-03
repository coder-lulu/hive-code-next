import { readHiveAgentJournal } from './hive-agent-journal-reference'
import { agentJournalSubmissionKey } from '../../shared/agent-session-journal-item-key'
import type { HiveAgentHostDependencies } from './hive-agent-session-dependencies'
import { readAgentJournalTurnOutcome } from '../../shared/agent-session-turn-record'

/** Run before accepting product writes after host restart; never acquires or dispatches a provider. */
export async function recoverHiveAgentSessions(deps: HiveAgentHostDependencies): Promise<void> {
  for (const entry of deps.store.hive.list()) {
    const { session, generation, turn } = entry.aggregate
    if (entry.deletionComplete) {
      continue
    }
    if (entry.deletedAt !== undefined && entry.deleteOperationId) {
      if (entry.aggregate.binding?.providerKind !== 'managed-pi') {
        throw new Error('hive_agent_forbidden')
      }
      await deps.releaseExecution?.(session.sessionId)
      const journal = await readHiveAgentJournal(deps, entry)
      await journal.purgeContent(deps.fenceFor(entry))
      await deps.store.hive.completeDeletion(session.sessionId, entry.deleteOperationId)
      continue
    }
    if (
      entry.deletedAt !== undefined ||
      !turn ||
      !generation ||
      !['PENDING', 'RUNNING', 'UNKNOWN'].includes(generation.state)
    ) {
      continue
    }
    const journal = await readHiveAgentJournal(deps, entry)
    const receiptId = agentJournalSubmissionKey(`${generation.generationId}:receipt`)
    const receipt = journal.snapshot().items.find((item) => item.itemId === receiptId)?.body
    const outcome =
      receipt?.kind === 'turn' &&
      receipt.turnId === turn.turnId &&
      receipt.userItemId === agentJournalSubmissionKey(turn.clientOperationId) &&
      receipt.state === 'completed'
        ? readAgentJournalTurnOutcome(receipt)
        : null
    const state = outcome === 'success' ? 'COMPLETED' : outcome === 'failure' ? 'FAILED' : 'UNKNOWN'
    await journal.markPendingSubmissionsUnknown(deps.fenceFor(entry))
    await deps.store.hive.settle({
      sessionId: session.sessionId,
      generationId: generation.generationId,
      callerKey: JSON.stringify(['hive-agent', entry.accountId, entry.deviceId]),
      operationId: turn.clientOperationId,
      state,
      now: deps.now()
    })
  }
}
