import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { SessionProjectAssignment } from '../../../../shared/session-project-assignment'
import {
  applySidebarSessionStatus,
  executionHostFromBucket,
  executionHostFromWorktreeValue,
  isFloatingWorktreeId,
  isStableTerminalSession,
  isStableUnifiedSession,
  type MutableSidebarSession,
  normalizeWorktreeId,
  sessionIdentity,
  sessionOwnerKey,
  type SessionKeysByTabId,
  statusFromLabel,
  timestamp,
  titleForTerminalTab,
  titleForUnifiedTab,
  upsertSidebarSession
} from './sidebar-session-projection'

export type SidebarSessionStatus = 'running' | 'waiting' | 'completed' | 'error'

export type TemporarySessionItem = {
  /** Stable provider/session identity when one exists, otherwise the tab id. */
  id: string
  title: string
  /** Store key used to activate the owning workspace. Null means a standalone session. */
  worktreeId: string | null
  /** Exact store bucket. Remote temporary sessions use a host-qualified key. */
  ownerBucketKey: string | null
  /** Unified workspace-tab identity used to restore the visible tab/group. */
  unifiedTabId: string | null
  /** Terminal-pane identity used by terminal activation and safe close. */
  terminalTabId: string | null
  /** Preferred restore identity. Kept for drag/save compatibility. */
  tabId: string | null
  paneKey: string | null
  executionHostId: ExecutionHostId | null
  status: SidebarSessionStatus
  lastActivityAt: number
  /** Optional project/workspace label shown as quiet secondary metadata. */
  contextLabel?: string
  projectAssignment?: SessionProjectAssignment
}

export type SidebarSessionItem = TemporarySessionItem

export type TemporarySessionCollectionInput = {
  unifiedTabsByWorktree?: Readonly<Record<string, readonly Tab[] | undefined>>
  tabsByWorktree?: Readonly<Record<string, readonly TerminalTab[] | undefined>>
  agentStatusByPaneKey?: Readonly<Record<string, AgentStatusEntry | undefined>>
  retainedAgentsByPaneKey?: Readonly<Record<string, { entry: AgentStatusEntry } | undefined>>
}

export type TemporarySessionCollection = {
  items: TemporarySessionItem[]
  totalCount: number
}

export type TemporarySessionCollectionOptions = {
  limit?: number
}

type SidebarSessionInput = TemporarySessionCollectionInput & {
  workspaceLabels?: ReadonlyMap<string, string>
  maxItems?: number
  /** Restrict the projection to sessions that are not owned by a workspace. */
  temporaryOnly?: boolean
}

const DEFAULT_MAX_ITEMS = 4

function buildSessionMap(input: SidebarSessionInput): Map<string, MutableSidebarSession> {
  const sessions = new Map<string, MutableSidebarSession>()
  const aliases = new Map<string, string>()
  const workspaceLabels = input.workspaceLabels ?? new Map<string, string>()

  for (const [bucketKey, tabs] of Object.entries(input.unifiedTabsByWorktree ?? {})) {
    for (const tab of tabs ?? []) {
      if (!isStableUnifiedSession(tab)) {
        continue
      }
      const worktreeId = normalizeWorktreeId(tab.worktreeId, bucketKey)
      if (
        input.temporaryOnly &&
        !isSidebarTemporarySession({ worktreeId, projectAssignment: tab.projectAssignment })
      ) {
        continue
      }
      const executionHostId =
        tab.executionHostId ??
        executionHostFromWorktreeValue(tab.worktreeId) ??
        executionHostFromBucket(bucketKey)
      const providerId = tab.structuredSessionId || tab.aiVaultTitle?.sessionId
      const sourceKey = sessionIdentity(
        sessionOwnerKey(worktreeId, bucketKey, executionHostId),
        tab
      )
      upsertSidebarSession(
        sessions,
        {
          id: providerId || tab.id,
          title: titleForUnifiedTab(tab),
          worktreeId,
          ownerBucketKey: bucketKey,
          unifiedTabId: tab.id,
          terminalTabId: tab.contentType === 'terminal' ? tab.entityId : null,
          tabId: tab.id,
          paneKey: null,
          executionHostId,
          status: statusFromLabel(`${tab.label} ${tab.contentType}`),
          lastActivityAt: timestamp(tab.lastFocusedAt ?? tab.createdAt),
          contextLabel: worktreeId ? workspaceLabels.get(worktreeId) : undefined,
          ...(tab.projectAssignment ? { projectAssignment: tab.projectAssignment } : {}),
          sourceKey
        },
        aliases
      )
    }
  }

  for (const [bucketKey, tabs] of Object.entries(input.tabsByWorktree ?? {})) {
    for (const tab of tabs ?? []) {
      if (!isStableTerminalSession(tab)) {
        continue
      }
      const worktreeId = normalizeWorktreeId(tab.worktreeId, bucketKey)
      if (
        input.temporaryOnly &&
        !isSidebarTemporarySession({ worktreeId, projectAssignment: tab.projectAssignment })
      ) {
        continue
      }
      const executionHostId =
        executionHostFromWorktreeValue(tab.worktreeId) ?? executionHostFromBucket(bucketKey)
      const providerId = tab.aiVaultTitle?.sessionId
      const sourceKey = `${sessionOwnerKey(worktreeId, bucketKey, executionHostId)}|${providerId || tab.id}`
      upsertSidebarSession(
        sessions,
        {
          id: providerId || tab.id,
          title: titleForTerminalTab(tab),
          worktreeId,
          ownerBucketKey: bucketKey,
          unifiedTabId: null,
          terminalTabId: tab.id,
          tabId: tab.id,
          paneKey: null,
          executionHostId,
          status: statusFromLabel(tab.title),
          lastActivityAt: timestamp(tab.createdAt),
          contextLabel: worktreeId ? workspaceLabels.get(worktreeId) : undefined,
          ...(tab.projectAssignment ? { projectAssignment: tab.projectAssignment } : {}),
          sourceKey
        },
        aliases
      )
    }
  }

  // Status maps may contain thousands of updates while the sidebar contains
  // hundreds of sessions. Index once by tab id instead of rescanning every
  // projected session for every status entry.
  const sessionKeysByTabId: SessionKeysByTabId = new Map()
  for (const [sessionKey, session] of sessions) {
    const tabIds = new Set(
      [session.tabId, session.unifiedTabId, session.terminalTabId].filter(
        (value): value is string => Boolean(value)
      )
    )
    for (const tabId of tabIds) {
      const keys = sessionKeysByTabId.get(tabId) ?? new Set<string>()
      keys.add(sessionKey)
      sessionKeysByTabId.set(tabId, keys)
    }
  }

  const includeUnmatchedStatusEntries = input.temporaryOnly !== true
  for (const [paneKey, entry] of Object.entries(input.agentStatusByPaneKey ?? {})) {
    if (entry) {
      applySidebarSessionStatus(
        sessions,
        aliases,
        sessionKeysByTabId,
        paneKey,
        entry,
        workspaceLabels,
        includeUnmatchedStatusEntries
      )
    }
  }
  for (const [paneKey, retained] of Object.entries(input.retainedAgentsByPaneKey ?? {})) {
    if (retained?.entry) {
      applySidebarSessionStatus(
        sessions,
        aliases,
        sessionKeysByTabId,
        paneKey,
        retained.entry,
        workspaceLabels,
        includeUnmatchedStatusEntries
      )
    }
  }
  return sessions
}

function compareSessions(left: MutableSidebarSession, right: MutableSidebarSession): number {
  return (
    Number(right.status === 'running') - Number(left.status === 'running') ||
    right.lastActivityAt - left.lastActivityAt ||
    left.title.localeCompare(right.title)
  )
}

function publicSession({
  sourceKey: _sourceKey,
  ...session
}: MutableSidebarSession): TemporarySessionItem {
  return session
}

function collectSessions(
  sessions: ReadonlyMap<string, MutableSidebarSession>,
  include: (session: MutableSidebarSession) => boolean,
  limit?: number
): TemporarySessionCollection {
  const normalizedLimit = limit === undefined ? undefined : Math.max(0, Math.floor(limit))
  const selected: MutableSidebarSession[] = []
  let totalCount = 0

  for (const session of sessions.values()) {
    if (!include(session)) {
      continue
    }
    totalCount += 1
    if (normalizedLimit === undefined) {
      selected.push(session)
      continue
    }
    const insertionIndex = selected.findIndex((item) => compareSessions(session, item) < 0)
    if (insertionIndex !== -1) {
      selected.splice(insertionIndex, 0, session)
      if (selected.length > normalizedLimit) {
        selected.pop()
      }
    } else if (selected.length < normalizedLimit) {
      selected.push(session)
    }
  }
  if (normalizedLimit === undefined) {
    selected.sort(compareSessions)
  }
  return { items: selected.map(publicSession), totalCount }
}

/** Build the complete temporary-session collection or its ordered top-N preview. */
export function buildTemporarySessionCollection(
  input: TemporarySessionCollectionInput,
  options: TemporarySessionCollectionOptions = {}
): TemporarySessionCollection {
  return collectSessions(
    buildSessionMap({ ...input, temporaryOnly: true }),
    (session) => isSidebarTemporarySession(session) && isRestorableSidebarSession(session),
    options.limit
  )
}

/** Backward-compatible projection for callers that also include workspace sessions. */
export function buildSidebarSessionItems(input: SidebarSessionInput): SidebarSessionItem[] {
  const maxItems = Math.max(1, input.maxItems ?? DEFAULT_MAX_ITEMS)
  return collectSessions(
    buildSessionMap(input),
    (session) =>
      !input.temporaryOnly ||
      (isSidebarTemporarySession(session) && isRestorableSidebarSession(session)),
    maxItems
  ).items
}

export function isSidebarTemporarySession(
  item: Pick<SidebarSessionItem, 'worktreeId' | 'projectAssignment'>
): boolean {
  return (
    !item.projectAssignment && (item.worktreeId === null || isFloatingWorktreeId(item.worktreeId))
  )
}

/** A clickable sidebar row must still have a tab owned by the current store snapshot. */
export function isRestorableSidebarSession(
  item: Pick<SidebarSessionItem, 'unifiedTabId' | 'terminalTabId'>
): boolean {
  return Boolean(item.unifiedTabId || item.terminalTabId)
}

export function temporarySessionIdentityKey(
  item: Pick<TemporarySessionItem, 'id' | 'ownerBucketKey' | 'worktreeId'>
): string {
  return `${item.ownerBucketKey ?? item.worktreeId ?? 'standalone'}|${item.id}`
}
