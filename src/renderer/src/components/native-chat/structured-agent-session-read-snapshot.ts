import {
  reduceStructuredAgentSession,
  type StructuredAgentSessionAction
} from '../../../../shared/structured-agent-session-reducer'
import type { StructuredAgentSessionReadSnapshot } from './structured-agent-session-read-owner'

export function reduceStructuredAgentSessionReadSnapshot(
  snapshot: StructuredAgentSessionReadSnapshot,
  action: StructuredAgentSessionAction,
  now: number
): StructuredAgentSessionReadSnapshot {
  const state = reduceStructuredAgentSession(snapshot.state, action, now)
  const isJournalRead =
    action.type === 'tail-page' || (action.type === 'event' && action.event.type !== 'end')
  const cursor =
    action.type === 'tail-page'
      ? (action.page.liveCursor ?? action.page.window.newest)
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
