import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../../shared/agent-session-journal-types'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  agentStatusEvidenceObservedAt,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { RemoteForegroundEvidence } from '../../../../shared/foreground-process-evidence'
import type { RuntimeHostConnectionState } from '../../../../shared/runtime-host-connection-state'
import type { SshConnectionStatus } from '../../../../shared/ssh-types'
import { projectStructuredAgentSessionStatus } from '../../../../shared/structured-agent-session-projection'
import {
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity
} from '../../../../shared/worktree/host-qualified-identity'
import { parseAgentStatusPaneIdentity } from '../../lib/agent-status-worktree-attribution'
import { isExplicitAgentStatusFresh } from '../../lib/pane-agent-evidence'

export type SessionListIdentity = {
  ownerBucketKey: string
  executionHostId: ExecutionHostId
  tabId: string
  paneKey: string | null
  providerSessionId: string | null
}

type Scoped<T> = { identity: SessionListIdentity; value: T }
type ConnectionState = RuntimeHostConnectionState | SshConnectionStatus | 'unknown'
type Activity = 'unknown' | 'running' | 'waiting' | 'permission' | 'completed' | 'error'
type ActivityStatus = { activity: Activity; reason: string | null; lastActivityAt: number | null }

type ActivityEvidence =
  | { kind: 'hook'; entry: AgentStatusEntry }
  | {
      kind: 'journal'
      items: readonly AgentJournalRenderItem[]
      latestSubmission?: AgentJournalSubmission
      /** Replica receipt when activity evidence advances; replay/heartbeat must retain it. */
      receivedAt: number
    }

export type SessionListStatusInput = {
  identity: SessionListIdentity
  connection: Scoped<ConnectionState> | null
  activity: Scoped<ActivityEvidence> | null
  /** Consume the execution owner's CURRENT verdict, after its freshness/incarnation gates.
   *  A cached inspect-process response must go through that resolver first. */
  execution: Scoped<{ verdict: RemoteForegroundEvidence['verdict']; reason: string | null }> | null
  now: number
}

export type SessionListStatus = ActivityStatus & {
  connection: ConnectionState
  execution: RemoteForegroundEvidence['verdict']
  executionReason: string | null
}

function sameSession(a: SessionListIdentity, b: SessionListIdentity): boolean {
  return (
    a.ownerBucketKey === b.ownerBucketKey &&
    a.executionHostId === b.executionHostId &&
    a.tabId === b.tabId &&
    a.paneKey === b.paneKey &&
    a.providerSessionId === b.providerSessionId
  )
}

function eventTime(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function unknownActivity(lastActivityAt: number | null = null): ActivityStatus {
  return { activity: 'unknown', reason: null, lastActivityAt }
}

function hookActivity(
  identity: SessionListIdentity,
  entry: AgentStatusEntry,
  now: number
): ActivityStatus {
  const entryTabId = entry.tabId ?? parseAgentStatusPaneIdentity(entry.paneKey)?.tabId
  const entryHost = entry.worktreeId
    ? getExecutionHostIdFromWorktreeHostIdentity(entry.worktreeId)
    : undefined
  if (
    entryTabId !== identity.tabId ||
    (entryHost !== undefined && entryHost !== identity.executionHostId) ||
    (identity.paneKey !== null && entry.paneKey !== identity.paneKey) ||
    (identity.providerSessionId !== null &&
      entry.providerSession?.id !== identity.providerSessionId) ||
    (entry.worktreeId !== undefined &&
      getWorktreeIdFromHostIdentity(entry.worktreeId) !==
        getWorktreeIdFromHostIdentity(identity.ownerBucketKey))
  ) {
    return unknownActivity()
  }

  // Launch/title rows and identity refreshes are not activity observations.
  if (
    !entry.observation ||
    !['hook', 'osc'].includes(entry.observation.origin) ||
    entry.observation.kind === 'identity-only'
  ) {
    return unknownActivity()
  }

  const lastActivityAt = eventTime(entry.stateStartedAt)
  const observedAt = eventTime(agentStatusEvidenceObservedAt(entry))
  if (
    observedAt === null ||
    observedAt > now ||
    !isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)
  ) {
    return unknownActivity(lastActivityAt)
  }
  const activity: Activity =
    entry.state === 'working'
      ? 'running'
      : entry.state === 'done'
        ? entry.interrupted || entry.sessionBoundary
          ? 'unknown'
          : 'completed'
        : 'waiting'
  return { activity, reason: null, lastActivityAt }
}

function journalActivity(
  evidence: Extract<ActivityEvidence, { kind: 'journal' }>,
  now: number
): ActivityStatus {
  const { items, latestSubmission, receivedAt } = evidence
  const latest = items.at(-1)
  const lastActivityAt = eventTime(latest?.observedAt)
  if (
    eventTime(receivedAt) === null ||
    receivedAt > now ||
    now - receivedAt > AGENT_STATUS_STALE_AFTER_MS
  ) {
    return unknownActivity(lastActivityAt)
  }
  const status = projectStructuredAgentSessionStatus(items)
  if (status === 'attention') {
    const approval = items.some(
      (item) => item.body.kind === 'approval' && item.body.resolution.state === 'pending'
    )
    return { activity: approval ? 'permission' : 'waiting', reason: null, lastActivityAt }
  }
  if (status === 'working') {
    return { activity: 'running', reason: null, lastActivityAt }
  }

  const rejectedAt = eventTime(latestSubmission?.resolvedAt ?? undefined)
  if (
    latestSubmission?.dispatchState === 'rejected' &&
    rejectedAt !== null &&
    rejectedAt >= (lastActivityAt ?? 0)
  ) {
    return { activity: 'error', reason: latestSubmission.reason, lastActivityAt: rejectedAt }
  }
  // A settled lifecycle also covers cancellation; it cannot prove successful completion.
  return unknownActivity(lastActivityAt)
}

/** Pure presentation for P2/P4. Call from the existing semantic-epoch projection; no title/focus clocks. */
export function resolveSessionListStatus(input: SessionListStatusInput): SessionListStatus {
  const { identity, now } = input
  const qualified =
    Boolean(identity.tabId) &&
    getExecutionHostIdFromWorktreeHostIdentity(identity.ownerBucketKey) === identity.executionHostId
  const connection =
    qualified && input.connection && sameSession(identity, input.connection.identity)
      ? input.connection.value
      : 'unknown'
  const evidence =
    qualified && input.activity && sameSession(identity, input.activity.identity)
      ? input.activity.value
      : null
  const activity =
    !Number.isFinite(now) || !evidence
      ? unknownActivity()
      : evidence.kind === 'hook'
        ? hookActivity(identity, evidence.entry, now)
        : journalActivity(evidence, now)
  const execution =
    connection === 'connected' && input.execution && sameSession(identity, input.execution.identity)
      ? input.execution.value
      : null
  return {
    ...activity,
    connection,
    execution: execution?.verdict ?? 'unverifiable',
    executionReason: execution?.reason ?? null
  }
}
