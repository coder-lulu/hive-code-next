import {
  reduceStructuredAgentSession,
  type StructuredAgentSessionAction
} from '../../../../shared/structured-agent-session-reducer'
import type { StructuredAgentSessionReadSnapshot } from './structured-agent-session-read-owner-contract'

/** Receipt is local transport evidence, never the host's activity timestamp. */
export function reduceStructuredReadSnapshot(
  snapshot: StructuredAgentSessionReadSnapshot,
  action: StructuredAgentSessionAction
): StructuredAgentSessionReadSnapshot {
  const now = Date.now()
  const state = reduceStructuredAgentSession(snapshot.state, action, now)
  const acceptedReceipt =
    action.type === 'history-page' ||
    (action.type === 'event' &&
      action.event.type !== 'end' &&
      (state !== snapshot.state ||
        (action.event.type === 'batch' &&
          action.event.batch.cursor.epoch === snapshot.state.epoch &&
          action.event.batch.cursor.sequence === snapshot.state.cursor?.sequence)))
  const receivedAt = acceptedReceipt ? now : snapshot.receivedAt
  const current =
    snapshot.current ||
    (acceptedReceipt &&
      action.type === 'event' &&
      !(action.event.type === 'batch' && action.event.hasNewer))
  return state !== snapshot.state ||
    current !== snapshot.current ||
    receivedAt !== snapshot.receivedAt
    ? { ...snapshot, state, current, receivedAt }
    : snapshot
}
