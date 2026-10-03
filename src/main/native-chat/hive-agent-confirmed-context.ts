import {
  agentJournalSubmissionKey,
  parseAgentJournalItemKey
} from '../../shared/agent-session-journal-item-key'
import {
  hiveAgentGenerationIdSchema,
  hiveAgentTurnIdSchema
} from '../../shared/hive-agent-session-schema'
import {
  parseHiveAgentTextContext,
  type HiveAgentContextMessage
} from '../../shared/hive-agent-text-context'
import type { AgentSessionJournal } from './agent-session-journal/journal-store'

/** Only host-confirmed complete pairs enter a new generation; timeline text is not authority. */
export function readHiveAgentConfirmedContext(
  journal: AgentSessionJournal,
  text: string
): readonly HiveAgentContextMessage[] {
  let history = parseHiveAgentTextContext([], text)
  if (journal.isReadOnly) {
    throw new Error('hive_agent_outcome_unknown')
  }
  const snapshot = journal.snapshot()
  const items = new Map(snapshot.items.map((item) => [item.itemId, item]))
  const accepted = new Set(
    snapshot.submissions
      .filter((submission) => submission.dispatchState === 'accepted' && !submission.recovered)
      .map((submission) => agentJournalSubmissionKey(submission.clientMessageId))
  )
  const seen = new Set<string>()
  for (const receipt of [...snapshot.items].sort((a, b) => b.sequence - a.sequence)) {
    const body = receipt.body
    const identity = parseAgentJournalItemKey(receipt.itemId)
    if (
      receipt.recovered ||
      identity?.provider !== 'orca' ||
      !identity.clientMessageId.endsWith(':receipt') ||
      body.kind !== 'turn' ||
      body.state !== 'completed' ||
      body.outcome !== 'success' ||
      !body.userItemId ||
      !accepted.has(body.userItemId) ||
      !hiveAgentTurnIdSchema.safeParse(body.turnId).success
    ) {
      continue
    }
    const generationId = identity.clientMessageId.slice(0, -':receipt'.length)
    if (!hiveAgentGenerationIdSchema.safeParse(generationId).success) {
      continue
    }
    const user = items.get(body.userItemId)
    const assistant = items.get(agentJournalSubmissionKey(`${generationId}:assistant`))
    if (
      !user ||
      !assistant ||
      user.recovered ||
      assistant.recovered ||
      user.sequence >= assistant.sequence ||
      assistant.sequence >= receipt.sequence ||
      seen.has(body.userItemId) ||
      seen.has(body.turnId)
    ) {
      continue
    }
    if (
      user.body.kind !== 'message' ||
      user.body.role !== 'user' ||
      assistant.body.kind !== 'message' ||
      assistant.body.role !== 'assistant' ||
      user.body.blocks.length !== 1 ||
      assistant.body.blocks.length !== 1 ||
      user.body.blocks[0].type !== 'text' ||
      assistant.body.blocks[0].type !== 'text'
    ) {
      continue
    }
    seen.add(body.userItemId)
    seen.add(body.turnId)
    const pair = [
      { role: 'user', text: user.body.blocks[0].text },
      { role: 'assistant', text: assistant.body.blocks[0].text }
    ]
    try {
      history = parseHiveAgentTextContext([...pair, ...history], text)
    } catch {
      break
    }
  }
  return history
}
