import {
  AGENT_STATUS_STALE_AFTER_MS,
  agentStatusEvidenceObservedAt,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity
} from '../../../../shared/worktree/host-qualified-identity'
import { parseAgentStatusPaneIdentity } from '@/lib/agent-status-worktree-attribution'
import { isExplicitAgentStatusFresh } from '@/lib/pane-agent-evidence'
import { collectLeafIds } from '../terminal-pane/terminal-pane-layout-tree'
import type { SessionListItem } from './session-list-types'

type HookEntries = Readonly<Record<string, AgentStatusEntry | undefined>>
type TerminalLayouts = Readonly<Record<string, TerminalLayoutSnapshot | undefined>>

function scopeKey(tab: string, host: string | null, workspace: string | null): string {
  return JSON.stringify([tab, host, workspace])
}

/** One immutable inventory index; no row scan is needed per status lookup. */
export function createSessionHookMatcher(items: readonly SessionListItem[], entries: HookEntries) {
  const ownersByScope = new Map<string, Map<string, SessionListItem[]>>()
  for (const item of items) {
    const tabId = item.terminalTabId ?? item.tabId
    if (item.kind === 'structured' || !tabId) {
      continue
    }
    const owner = JSON.stringify([
      item.executionHostId,
      item.worktreeId,
      item.executionHostId ? null : item.ownerBucketKey
    ])
    const keys = new Set([
      scopeKey(tabId, null, null),
      scopeKey(tabId, item.executionHostId, null),
      scopeKey(tabId, null, item.worktreeId),
      scopeKey(tabId, item.executionHostId, item.worktreeId)
    ])
    for (const key of keys) {
      const owners = ownersByScope.get(key) ?? new Map<string, SessionListItem[]>()
      const rows = owners.get(owner) ?? []
      rows.push(item)
      owners.set(owner, rows)
      ownersByScope.set(key, owners)
    }
  }
  const hooksByItemKey = new Map<string, Set<AgentStatusEntry>>()
  for (const entry of Object.values(entries)) {
    if (!entry) {
      continue
    }
    const pane = parseAgentStatusPaneIdentity(entry.paneKey)
    if (!pane || (entry.tabId && entry.tabId !== pane.tabId)) {
      continue
    }
    const host = getExecutionHostIdFromWorktreeHostIdentity(entry.worktreeId ?? '') ?? null
    const workspace = entry.worktreeId ? getWorktreeIdFromHostIdentity(entry.worktreeId) : null
    const owners = ownersByScope.get(scopeKey(pane.tabId, host, workspace))
    if (owners?.size !== 1) {
      continue
    }
    for (const item of owners.values().next().value!) {
      const hooks = hooksByItemKey.get(item.key) ?? new Set<AgentStatusEntry>()
      hooks.add(entry)
      hooksByItemKey.set(item.key, hooks)
    }
  }
  return (
    item: SessionListItem,
    options: { matchProvider?: boolean } = {}
  ): AgentStatusEntry | null => {
    if (item.kind === 'structured' || !item.executionHostId) {
      return null
    }
    const matches = [...(hooksByItemKey.get(item.key) ?? [])].filter(
      (entry) =>
        (!item.paneKey || item.paneKey === entry.paneKey) &&
        (options.matchProvider === false ||
          ((!item.providerSessionId || entry.providerSession?.id === item.providerSessionId) &&
            (!item.agent ||
              !entry.agentType ||
              entry.agentType === 'unknown' ||
              entry.agentType === item.agent)))
    )
    // A split terminal can contain different conversations; no arbitrary pane wins.
    return matches.length === 1 ? matches[0] : null
  }
}

/** Only current, observed provider identity on a resident layout leaf can replace tab metadata. */
export function currentProviderHookEntries(
  entries: HookEntries,
  layouts: TerminalLayouts | undefined,
  now: number
): HookEntries {
  const current: Record<string, AgentStatusEntry> = {}
  const leavesByTab = new Map<string, Set<string>>()
  if (!layouts || !Number.isFinite(now)) {
    return current
  }
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry?.providerSession?.id.trim() || entry.terminalResumeEligible === false) {
      continue
    }
    const pane = parsePaneKey(entry.paneKey)
    const observedAt = agentStatusEvidenceObservedAt(entry)
    if (
      !pane ||
      (entry.tabId && entry.tabId !== pane.tabId) ||
      !entry.observation ||
      !['hook', 'osc'].includes(entry.observation.origin) ||
      entry.observation.kind === 'identity-only' ||
      !Number.isFinite(observedAt) ||
      observedAt <= 0 ||
      observedAt > now ||
      !isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)
    ) {
      continue
    }
    let leaves = leavesByTab.get(pane.tabId)
    if (!leaves) {
      leaves = new Set(collectLeafIds(layouts[pane.tabId]?.root))
      leavesByTab.set(pane.tabId, leaves)
    }
    if (leaves.has(pane.leafId)) {
      current[key] = entry
    }
  }
  return current
}
