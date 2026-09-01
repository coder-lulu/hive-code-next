import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
export { isTerminalTabSessionRecord as isStableTerminalSession } from '../../../../shared/terminal-tab-session'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity
} from '../../../../shared/worktree/host-qualified-identity'
import type { SidebarSessionStatus, TemporarySessionItem } from './sidebar-session-model'

export type MutableSidebarSession = TemporarySessionItem & {
  sourceKey: string
}

export type SessionKeysByTabId = Map<string, Set<string>>

export const EMPTY_SESSION_TITLE = 'Agent session'

export function timestamp(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function isFloatingWorktreeId(value: string | null | undefined): boolean {
  return (
    value === FLOATING_TERMINAL_WORKTREE_ID ||
    value?.endsWith(`|${FLOATING_TERMINAL_WORKTREE_ID}`) === true
  )
}

export function statusFromLabel(label: string): SidebarSessionStatus {
  const normalized = label.toLowerCase()
  if (/(error|failed|broken|crash)/.test(normalized)) {
    return 'error'
  }
  if (/(wait|review|blocked|paused|permission)/.test(normalized)) {
    return 'waiting'
  }
  if (/(done|complete|closed|merged)/.test(normalized)) {
    return 'completed'
  }
  return 'waiting'
}

export function statusFromAgentState(state: AgentStatusEntry['state']): SidebarSessionStatus {
  switch (state) {
    case 'working':
      return 'running'
    case 'blocked':
    case 'waiting':
      return 'waiting'
    case 'done':
      return 'completed'
  }
}

export function titleForUnifiedTab(tab: Tab): string {
  return (
    tab.customLabel?.trim() ||
    tab.quickCommandLabel?.trim() ||
    tab.aiVaultTitle?.title?.trim() ||
    tab.generatedLabel?.trim() ||
    tab.label?.trim() ||
    EMPTY_SESSION_TITLE
  )
}

export function titleForTerminalTab(tab: TerminalTab): string {
  return (
    tab.customTitle?.trim() ||
    tab.quickCommandLabel?.trim() ||
    tab.aiVaultTitle?.title?.trim() ||
    tab.generatedTitle?.trim() ||
    tab.title?.trim() ||
    EMPTY_SESSION_TITLE
  )
}

export function isStableUnifiedSession(tab: Tab): boolean {
  return (
    tab.contentType === 'agent-session' ||
    Boolean(tab.structuredSessionId) ||
    Boolean(tab.agentSessionAgent) ||
    Boolean(tab.aiVaultTitle?.sessionId)
  )
}

export function sessionIdentity(
  worktreeId: string,
  tab: Pick<Tab, 'id' | 'entityId' | 'structuredSessionId' | 'aiVaultTitle'>
): string {
  const providerId = tab.structuredSessionId || tab.aiVaultTitle?.sessionId
  return `${worktreeId}|${providerId || tab.entityId || tab.id}`
}

export function tabIdFromPaneKey(paneKey: string): string | null {
  return parsePaneKey(paneKey)?.tabId ?? parseLegacyNumericPaneKey(paneKey)?.tabId ?? null
}

export function statusEntryTitle(entry: AgentStatusEntry): string {
  return (
    entry.orchestration?.displayName?.trim() ||
    entry.orchestration?.taskTitle?.trim() ||
    entry.terminalTitle?.trim() ||
    entry.prompt?.trim() ||
    EMPTY_SESSION_TITLE
  )
}

export function normalizeWorktreeId(value: string | undefined, bucketKey: string): string | null {
  const rawCandidate = value?.trim() || bucketKey.trim()
  const candidate =
    rawCandidate && isWorktreeHostIdentity(rawCandidate)
      ? getWorktreeIdFromHostIdentity(rawCandidate)
      : rawCandidate
  if (!candidate || isFloatingWorktreeId(candidate)) {
    return isFloatingWorktreeId(candidate) ? FLOATING_TERMINAL_WORKTREE_ID : null
  }
  return candidate
}

export function executionHostFromBucket(bucketKey: string): ExecutionHostId | null {
  return getExecutionHostIdFromWorktreeHostIdentity(bucketKey) ?? null
}

export function executionHostFromWorktreeValue(value: string | undefined): ExecutionHostId | null {
  return value && isWorktreeHostIdentity(value)
    ? (getExecutionHostIdFromWorktreeHostIdentity(value) ?? null)
    : null
}

export function sessionOwnerKey(
  worktreeId: string | null,
  bucketKey: string,
  executionHostId: ExecutionHostId | null
): string {
  if (executionHostId && worktreeId) {
    return `${executionHostId}|${worktreeId}`
  }
  return worktreeId || bucketKey || 'standalone'
}

export function upsertSidebarSession(
  sessions: Map<string, MutableSidebarSession>,
  session: MutableSidebarSession,
  aliases: Map<string, string>
): void {
  const existingKey = aliases.get(session.sourceKey) ?? session.sourceKey
  const existing = sessions.get(existingKey)
  if (!existing) {
    sessions.set(existingKey, session)
    aliases.set(session.sourceKey, existingKey)
    return
  }
  const unifiedTabId = existing.unifiedTabId ?? session.unifiedTabId
  const terminalTabId = existing.terminalTabId ?? session.terminalTabId
  const ownerBucketKey = existing.ownerBucketKey ?? session.ownerBucketKey
  const mergedIdentity = {
    ownerBucketKey,
    unifiedTabId,
    terminalTabId,
    tabId: unifiedTabId ?? terminalTabId ?? existing.tabId ?? session.tabId
  }
  // Unified and legacy tab snapshots describe the same session. Keep the
  // richer title/status and the freshest timestamp without emitting a second row.
  if (session.lastActivityAt >= existing.lastActivityAt) {
    sessions.set(existingKey, {
      ...existing,
      ...session,
      ...mergedIdentity,
      id: existing.id || session.id,
      sourceKey: existing.sourceKey
    })
  } else {
    Object.assign(existing, mergedIdentity)
    if (existing.title === EMPTY_SESSION_TITLE && session.title !== EMPTY_SESSION_TITLE) {
      existing.title = session.title
    }
  }
  aliases.set(session.sourceKey, existingKey)
}

export function applySidebarSessionStatus(
  sessions: Map<string, MutableSidebarSession>,
  aliases: Map<string, string>,
  sessionKeysByTabId: SessionKeysByTabId,
  paneKey: string,
  entry: AgentStatusEntry,
  workspaceLabels: ReadonlyMap<string, string>,
  includeUnmatched: boolean
): void {
  const tabId = entry.tabId || tabIdFromPaneKey(paneKey)
  const entryWorktreeId = normalizeWorktreeId(entry.worktreeId, '')
  const entryHostId = executionHostFromWorktreeValue(entry.worktreeId)
  const matchingEntries = tabId
    ? [...(sessionKeysByTabId.get(tabId) ?? [])].flatMap((sessionKey) => {
        const session = sessions.get(sessionKey)
        if (
          !session ||
          (session.tabId !== tabId &&
            session.unifiedTabId !== tabId &&
            session.terminalTabId !== tabId) ||
          (entryWorktreeId && session.worktreeId !== entryWorktreeId) ||
          (entryHostId && session.executionHostId !== entryHostId)
        ) {
          return []
        }
        return [[sessionKey, session] as const]
      })
    : []
  if (matchingEntries.length > 1) {
    // A bare hook cannot safely choose between mirrored host buckets.
    return
  }
  const matchingKey = matchingEntries.length === 1 ? matchingEntries[0][0] : undefined
  const status = statusFromAgentState(entry.state)
  // State transitions drive ordering; same-state heartbeat timestamps must not
  // silently reshuffle temporary sessions on a later unrelated invalidation.
  const activity = timestamp(entry.stateStartedAt || entry.updatedAt)
  if (matchingKey) {
    const existing = sessions.get(matchingKey)
    if (existing) {
      existing.paneKey = paneKey
    }
    if (existing && activity >= existing.lastActivityAt) {
      existing.status = status
      existing.lastActivityAt = activity
      if (existing.title === EMPTY_SESSION_TITLE) {
        existing.title = statusEntryTitle(entry)
      }
    }
    return
  }
  if (!includeUnmatched) {
    return
  }

  const worktreeId = entryWorktreeId
  const providerId = entry.providerSession?.id?.trim()
  if (!tabId && !providerId) {
    return
  }
  const stableId = providerId || tabId || paneKey
  const sourceKey = `${worktreeId || 'standalone'}|${stableId}`
  upsertSidebarSession(
    sessions,
    {
      id: stableId,
      title: statusEntryTitle(entry),
      worktreeId,
      ownerBucketKey: entry.worktreeId?.trim() || worktreeId,
      unifiedTabId: null,
      terminalTabId: null,
      tabId,
      paneKey,
      executionHostId: entryHostId,
      status,
      lastActivityAt: activity,
      contextLabel: worktreeId ? workspaceLabels.get(worktreeId) : undefined,
      sourceKey
    },
    aliases
  )
  if (tabId) {
    const canonicalKey = aliases.get(sourceKey) ?? sourceKey
    const keys = sessionKeysByTabId.get(tabId) ?? new Set<string>()
    keys.add(canonicalKey)
    sessionKeysByTabId.set(tabId, keys)
  }
}
