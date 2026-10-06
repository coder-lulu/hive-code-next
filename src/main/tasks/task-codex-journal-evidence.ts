import { readAgentJournalTurn } from '../../shared/agent-session-turn-record'
import { agentJournalSubmissionKey } from '../../shared/agent-session-journal-item-key'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

export function taskCodexSessionFor(record: TaskExecutionRecord) {
  if (record.launch?.outcome.kind !== 'structured') {
    return null
  }
  const host = getStructuredAgentSessionHost()
  const sessionId = record.launch.outcome.sessionId
  const session = host?.deps.store.getRecord(sessionId)
  if (
    !host ||
    !session ||
    session.provider !== 'codex' ||
    session.location.executionHostId !== 'local' ||
    session.location.wslDistro ||
    session.location.workspaceId !== record.workspace.workspaceId
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  return { host, session, sessionId }
}

/** Read the original accepted prompt's sole main turn, never the latest turn or provider history. */
export async function readTaskCodexJournalEvidence(record: TaskExecutionRecord) {
  const binding = taskCodexSessionFor(record)
  const prompt = record.launch?.prompt
  if (!binding || prompt?.outcome !== 'journaled') {
    return null
  }
  await binding.host.flushStreamedEvents(binding.sessionId)
  const snapshot = await binding.host.journalSnapshot(binding.sessionId)
  const submissions = snapshot.submissions.filter(
    (entry) => entry.clientMessageId === prompt.messageId
  )
  const submission = submissions[0]
  if (
    submissions.length !== 1 ||
    !submission ||
    submission.dispatchState !== 'accepted' ||
    !submission.providerItemId
  ) {
    return null
  }
  const matches = snapshot.items.filter(
    (entry) =>
      !entry.agentId &&
      readAgentJournalTurn(entry.body)?.userItemId === agentJournalSubmissionKey(prompt.messageId)
  )
  const turnItem = matches[0]
  const turn = readAgentJournalTurn(turnItem?.body)
  if (
    matches.length !== 1 ||
    !turnItem ||
    !turn ||
    turn.state !== 'completed' ||
    (turn.outcome !== 'success' && turn.outcome !== 'failure') ||
    snapshot.items.some(
      (entry) =>
        (entry.body.kind === 'tool-call' && entry.body.state === 'running') ||
        readAgentJournalTurn(entry.body)?.state === 'running'
    )
  ) {
    return null
  }
  return { ...binding, snapshot, submission, turnItem, turn, turnOutcome: turn.outcome }
}
