import { createHash } from 'node:crypto'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session-journal-types'
import type { CodexTeamToolCall } from './codex-team-task-tool-protocol'

export async function admitCodexTeamToolCall(
  sink: StructuredAgentSessionEventSink | undefined,
  call: CodexTeamToolCall,
  acquisitionGeneration: string,
  assertCurrent: () => void
): Promise<void> {
  assertCurrent()
  if (!sink?.tryAppendItem || !sink.tryPublish || !sink.written) {
    throw new Error('journal unavailable')
  }
  const key = createHash('sha256')
    .update(JSON.stringify([acquisitionGeneration, call.threadId, call.turnId, call.callId]))
    .digest('hex')
  const admitted = sink.tryAppendItem(
    { provider: 'orca', clientMessageId: `team-task-call:${key}` },
    {
      kind: 'status',
      text: `Team task tool admitted: ${call.tool}; turn ${call.turnId}; call ${call.callId}`
    },
    { turnScope: AGENT_JOURNAL_THREAD_SCOPE }
  )
  if (!admitted.accepted || !sink.tryPublish().accepted) {
    throw new Error('journal refused')
  }
  if (!(await sink.written()).ok) {
    throw new Error('journal write failed')
  }
  assertCurrent()
}
