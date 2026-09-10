import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { SessionListScope } from '../../../../shared/session-list-scope'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab, TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import {
  composeWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity
} from '../../../../shared/worktree/host-qualified-identity'
import type { DesktopHomeEntityProjection } from '../landing/desktop-home-model-entities'
import {
  isStableTerminalSession,
  isStableUnifiedSession
} from '../sidebar/sidebar-session-projection'
import { resolveSessionListStatus, type SessionListIdentity } from '../sidebar/session-list-status'
import type { SessionListItem, SessionProjectOption } from './session-list-types'
import { createSessionHookMatcher, currentProviderHookEntries } from './session-hook-matching'
import {
  createSessionInventoryItem,
  applyCurrentSessionProvider,
  deduplicateSessionInventory
} from './session-inventory-item'

export { createSessionHookMatcher } from './session-hook-matching'

export type SessionInventoryInput = {
  unifiedTabsByWorktree: Readonly<Record<string, readonly Tab[] | undefined>>
  tabsByWorktree: Readonly<Record<string, readonly TerminalTab[] | undefined>>
  agentStatusByPaneKey: Readonly<Record<string, AgentStatusEntry | undefined>>
  terminalLayoutsByTabId?: Readonly<Record<string, TerminalLayoutSnapshot | undefined>>
  entities: DesktopHomeEntityProjection
  now?: number
}

type InventoryCandidate = {
  item: SessionListItem
  tab?: Tab
  terminal?: TerminalTab
  stable: boolean
}

/** Keep all actual terminal owners in the index, even when they are not agent sessions yet. */
export function buildSessionInventoryProjection(input: SessionInventoryInput) {
  const candidates: InventoryCandidate[] = []
  const buckets = new Set([
    ...Object.keys(input.unifiedTabsByWorktree),
    ...Object.keys(input.tabsByWorktree)
  ])
  for (const bucket of buckets) {
    const terminals = new Map((input.tabsByWorktree[bucket] ?? []).map((tab) => [tab.id, tab]))
    const represented = new Set<string>()
    for (const tab of input.unifiedTabsByWorktree[bucket] ?? []) {
      if (tab.contentType !== 'terminal' && tab.contentType !== 'agent-session') {
        continue
      }
      const terminal = tab.contentType === 'terminal' ? terminals.get(tab.entityId) : undefined
      if (terminal) {
        represented.add(terminal.id)
      }
      candidates.push({
        item: createSessionInventoryItem(input.entities, bucket, tab, terminal),
        tab,
        terminal,
        stable:
          isStableUnifiedSession(tab) || Boolean(terminal && isStableTerminalSession(terminal))
      })
    }
    for (const terminal of terminals.values()) {
      if (!represented.has(terminal.id)) {
        candidates.push({
          item: createSessionInventoryItem(input.entities, bucket, undefined, terminal),
          terminal,
          stable: isStableTerminalSession(terminal)
        })
      }
    }
  }
  const ownerItems = candidates.map(({ item }) => item)
  const currentHooks = currentProviderHookEntries(
    input.agentStatusByPaneKey,
    input.terminalLayoutsByTabId,
    input.now ?? Date.now()
  )
  const matchCurrentHook = createSessionHookMatcher(ownerItems, currentHooks)
  const items = candidates.flatMap(({ item, tab, terminal, stable }) => {
    const current = terminal ? matchCurrentHook(item, { matchProvider: false }) : null
    return current
      ? [applyCurrentSessionProvider(item, tab, terminal, current)]
      : stable
        ? [item]
        : []
  })
  return {
    items: deduplicateSessionInventory(items),
    matchHook: createSessionHookMatcher(ownerItems, input.agentStatusByPaneKey)
  }
}

export function buildSessionInventory(input: SessionInventoryInput): SessionListItem[] {
  return buildSessionInventoryProjection(input).items
}

export function sessionStatusIdentity(item: SessionListItem): SessionListIdentity | null {
  if (!item.executionHostId || !item.ownerBucketKey || !item.tabId) {
    return null
  }
  return {
    ownerBucketKey: composeWorktreeHostIdentity(
      item.executionHostId,
      getWorktreeIdFromHostIdentity(item.ownerBucketKey)
    ),
    executionHostId: item.executionHostId,
    tabId: item.terminalTabId ?? item.tabId,
    paneKey: item.paneKey,
    providerSessionId: item.providerSessionId
  }
}

/** Kept for one-off consumers; collection projections construct the index once per inventory. */
export function findSessionHook(
  item: SessionListItem,
  items: readonly SessionListItem[],
  entries: SessionInventoryInput['agentStatusByPaneKey']
): AgentStatusEntry | null {
  return createSessionHookMatcher(items, entries)(item)
}

export function projectSessionHookStatus(
  item: SessionListItem,
  hook: AgentStatusEntry | null,
  connection: SessionListItem['status']['connection'],
  now: number
): SessionListItem {
  const next = { ...item, paneKey: hook?.paneKey ?? item.paneKey }
  const identity = sessionStatusIdentity(next)
  if (!identity) {
    return next
  }
  const status = resolveSessionListStatus({
    identity,
    now,
    connection: { identity, value: connection },
    activity: hook ? { identity, value: { kind: 'hook', entry: hook } } : null,
    execution: null
  })
  return {
    ...next,
    status,
    lastActivityAt: Math.max(item.lastActivityAt, status.lastActivityAt ?? 0)
  }
}

export function filterSessionInventory(
  items: readonly SessionListItem[],
  scope: SessionListScope,
  query: string
): SessionListItem[] {
  const needle = query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (scope.kind === 'unassigned' && item.projectKey !== null) {
      return false
    }
    if (scope.kind === 'project' && item.projectKey !== scope.projectKey) {
      return false
    }
    if (
      scope.kind === 'workspace' &&
      (item.worktreeId !== scope.workspaceKey.replace(/^worktree:/, '') ||
        item.executionHostId !== scope.executionHostId)
    ) {
      return false
    }
    return (
      !needle ||
      [item.title, item.projectLabel, item.workspaceLabel, item.workspacePath, item.hostLabel]
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle)
    )
  })
}

export function sessionProjects(
  entities: DesktopHomeEntityProjection,
  hostLabel: (host: ExecutionHostId) => string
): SessionProjectOption[] {
  return [...entities.projectsByIdentity.values()]
    .map((project) => ({
      key: project.identityKey,
      label: project.name,
      hostLabel: hostLabel(project.executionHostId)
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
}
