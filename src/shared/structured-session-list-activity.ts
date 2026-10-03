import {
  normalizeOptionalField,
  AGENT_STATUS_MAX_FIELD_LENGTH
} from './agent-status-field-normalization'
import type { AgentJournalRenderItem, AgentJournalSubmission } from './agent-session-journal-types'
import { readAgentJournalTurn, readAgentJournalTurnOutcome } from './agent-session-turn-record'
import type { StructuredAgentSessionProjectedStatus } from './structured-agent-session-projection'

export type StructuredSessionListActivity =
  | 'unknown'
  | 'running'
  | 'waiting'
  | 'permission'
  | 'completed'
  | 'error'

/** Preserve explicit host evidence without interpreting idle or cancellation as success. */
export function structuredSessionListActivity(
  status: StructuredAgentSessionProjectedStatus,
  items: readonly AgentJournalRenderItem[],
  submissions: readonly AgentJournalSubmission[] = [],
  currentFence?: number | null
): { activity: StructuredSessionListActivity; reason: string | null } {
  if (status === 'attention') {
    return {
      activity: items.some(
        (item) => item.body.kind === 'approval' && item.body.resolution.state === 'pending'
      )
        ? 'permission'
        : 'waiting',
      reason: null
    }
  }
  if (status === 'working') {
    return { activity: 'running', reason: null }
  }
  const latest = submissions.findLast(
    (submission) => currentFence == null || submission.fence >= currentFence
  )
  if (
    latest?.dispatchState === 'rejected' &&
    latest.resolvedAt != null &&
    latest.resolvedAt >= (items.at(-1)?.observedAt ?? 0)
  ) {
    return { activity: 'error', reason: latest.reason }
  }
  for (let index = items.length - 1; index >= 0; index--) {
    const body = items[index].body
    if (body.kind === 'message' && body.role === 'user') {
      break
    }
    const turn = readAgentJournalTurn(body)
    if (!turn) {
      continue
    }
    const outcome = readAgentJournalTurnOutcome(turn)
    return {
      activity:
        turn.state === 'completed' && outcome === 'success'
          ? 'completed'
          : outcome === 'failure'
            ? 'error'
            : 'unknown',
      reason: null
    }
  }
  return { activity: 'unknown', reason: null }
}

export function structuredSessionListActivityFields(
  detail: ReturnType<typeof structuredSessionListActivity>
) {
  const activityReason = normalizeOptionalField(
    detail.reason ?? undefined,
    AGENT_STATUS_MAX_FIELD_LENGTH
  )
  return {
    ...(['permission', 'completed', 'error'].includes(detail.activity)
      ? { activity: detail.activity }
      : {}),
    ...(activityReason ? { activityReason } : {})
  }
}
