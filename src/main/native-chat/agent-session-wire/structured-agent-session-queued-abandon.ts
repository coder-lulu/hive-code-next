import type { AgentJournalSubmission } from '../../../shared/agent-session-journal-types'
import { agentSessionFailureFact } from '../../../shared/agent-session-failure'
import { agentSessionFailureWords } from '../../../shared/agent-session-failure-words'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from './structured-agent-session-host-types'
import { structuredAgentSessionConversationFence } from './structured-agent-session-provider-child'

type ConversationCloseDeps = Pick<StructuredAgentSessionHostDeps, 'logger'> & {
  store: Pick<StructuredAgentSessionHostDeps['store'], 'getRecord'>
}

/** Rejects the queued messages a conversation close left behind; logs and returns false on failure. */
export async function abandonQueuedStructuredAgentSessionMessages(
  deps: ConversationCloseDeps,
  sessionId: string,
  journal: StructuredAgentSessionHostSession['journal'],
  which?: (submission: AgentJournalSubmission) => boolean
): Promise<boolean> {
  return journal
    .rejectQueuedSubmissions(
      structuredAgentSessionConversationFence(deps.store, sessionId),
      agentSessionFailureWords(agentSessionFailureFact('chatClosed'), { surface: 'rejection' }),
      which
    )
    .then(
      () => true,
      (error: unknown) => {
        deps.logger.warn('rejecting queued messages of a closed chat failed', {
          scope: 'queued-abandon',
          sessionId,
          error
        })
        return false
      }
    )
}
