import type { StoredAgentAttentionUnread } from '@/attention/agent-attention-contract'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { Tab } from '../../../shared/tab-types'
import type { Worktree } from '../../../shared/worktree/types'

/** The only fields the count reads, so a projection over them is a sound cache key. */
export type UnreadBadgeWorktree = Pick<Worktree, 'id' | 'isUnread'>
export type UnreadBadgeTab = Pick<TerminalTab, 'id'>
export type UnreadBadgeUnifiedTab = Pick<Tab, 'id' | 'entityId' | 'worktreeId'>

export type UnreadBadgeCountSources = {
  worktreesByRepo: Readonly<Record<string, readonly UnreadBadgeWorktree[]>>
  tabsByWorktree: Readonly<Record<string, readonly UnreadBadgeTab[]>>
  unreadTerminalTabs: Readonly<Record<string, StoredAgentAttentionUnread>>
  unifiedTabsByWorktree?: Readonly<Record<string, readonly UnreadBadgeUnifiedTab[]>>
  unreadAgentCompletionCountByPane?: Readonly<Record<string, number>>
}

export function getUnreadBadgeCount({
  worktreesByRepo,
  tabsByWorktree,
  unifiedTabsByWorktree = {},
  unreadTerminalTabs,
  unreadAgentCompletionCountByPane
}: UnreadBadgeCountSources): number {
  const completionCounts = unreadAgentCompletionCountByPane ?? {}
  const completionCount = Object.values(completionCounts).reduce(
    (total, count) => total + (Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0),
    0
  )
  const completionTabIds = new Set(
    Object.keys(completionCounts).map((paneKey) => {
      const separatorIndex = paneKey.indexOf(':')
      return separatorIndex === -1 ? paneKey : paneKey.slice(0, separatorIndex)
    })
  )
  const completionWorktreeIds = new Set<string>()
  const unreadWorktreeIds = new Set<string>()

  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      if (worktree.isUnread) {
        unreadWorktreeIds.add(worktree.id)
      }
    }
  }

  const unreadTabIds = new Set(Object.keys(unreadTerminalTabs))

  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    for (const tab of tabs) {
      if (completionTabIds.has(tab.id)) {
        completionWorktreeIds.add(worktreeId)
      }
      if (!unreadTabIds.delete(tab.id)) {
        continue
      }
      unreadWorktreeIds.add(worktreeId)
    }
  }

  // Structured agent sessions may exist only in the unified tab model. Use
  // both their UI id and backing entity id so their completion count replaces,
  // rather than duplicates, the owning worktree's legacy unread signal.
  for (const [bucketWorktreeId, tabs] of Object.entries(unifiedTabsByWorktree)) {
    for (const tab of tabs) {
      const worktreeId = tab.worktreeId || bucketWorktreeId
      const tabIds = tab.id === tab.entityId ? [tab.id] : [tab.id, tab.entityId]
      if (tabIds.some((tabId) => completionTabIds.has(tabId))) {
        completionWorktreeIds.add(worktreeId)
      }
      if (tabIds.some((tabId) => unreadTabIds.delete(tabId))) {
        unreadWorktreeIds.add(worktreeId)
      }
    }
  }

  for (const worktreeId of completionWorktreeIds) {
    unreadWorktreeIds.delete(worktreeId)
  }
  for (const tabId of completionTabIds) {
    unreadTabIds.delete(tabId)
  }

  // Why: tab unread state should normally map to a live worktree, but counting
  // unmatched entries keeps the Dock badge honest during hydration races.
  const legacyUnreadCount = unreadWorktreeIds.size + unreadTabIds.size
  return legacyUnreadCount + completionCount
}
