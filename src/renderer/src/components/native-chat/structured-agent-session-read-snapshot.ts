import {
  reduceStructuredAgentSession,
  type StructuredAgentSessionAction,
  type StructuredAgentSessionState
} from '../../../../shared/structured-agent-session-reducer'
import type { AgentProviderSessionMetadata } from '../../../../shared/agent-session-resume'

export type StructuredAgentSessionReadSnapshot = {
  state: StructuredAgentSessionState
  loadingOlder: boolean
  /** Receipt of current journal evidence; older-history reads do not renew it. */
  receivedAt: number | null
  /** Bumped whenever older-page reads are invalidated (open, snapshot, reset, dispose). */
  olderHistoryGeneration: number
  providerSession?: AgentProviderSessionMetadata
  /** Whether `state` is the host's present: false from when reading stops or contact is lost
   *  until the read has caught up again. */
  current: boolean
}

export function reduceStructuredAgentSessionReadSnapshot(
  snapshot: StructuredAgentSessionReadSnapshot,
  action: StructuredAgentSessionAction,
  now: number
): StructuredAgentSessionReadSnapshot {
  const state = reduceStructuredAgentSession(snapshot.state, action, now)
  const isJournalRead =
    (action.type === 'history-page' && action.page.direction === 'tail') ||
    (action.type === 'event' && action.event.type !== 'end')
  const cursor =
    action.type === 'history-page' && action.page.direction === 'tail'
      ? (action.page.liveCursor ?? action.page.window.nextCursor)
      : action.type === 'event' && action.event.type === 'batch'
        ? action.event.batch.cursor
        : null
  const confirmsCurrentCursor =
    cursor !== null && cursor.epoch === state.epoch && cursor.sequence === state.cursor?.sequence
  const receivedAt =
    isJournalRead && (state !== snapshot.state || confirmsCurrentCursor) ? now : snapshot.receivedAt
  if (state !== snapshot.state || receivedAt !== snapshot.receivedAt) {
    return { ...snapshot, state, receivedAt }
  }
  return snapshot
}
