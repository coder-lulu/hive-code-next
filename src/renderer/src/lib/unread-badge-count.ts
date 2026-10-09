import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts
} from '@/components/sidebar/worktree-list/listing/host-filtering'
import { getRenderableFolderWorkspaces } from '@/components/sidebar/worktree-list/grouping/folder-workspace-lanes'
import { worktreeMatchesVisibleHost } from '@/components/sidebar/visible-worktree-host-scope'
import {
  filterFolderWorkspacesFromOtherDevices,
  isWorkspaceFromOtherDevice
} from '@/components/sidebar/workspace-creator-visibility'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import type { StoredAgentAttentionUnread } from '@/attention/agent-attention-contract'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { Tab } from '../../../shared/tab-types'
import type { Worktree } from '../../../shared/worktree/types'

export type UnreadBadgeCountSources = {
  worktreesByRepo: Readonly<Record<string, readonly Worktree[]>>
  folderWorkspaces: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
  repoMap: Map<string, Repo>
  /** null when the sidebar shows every host. */
  visibleHostIds: ReadonlySet<ExecutionHostId> | null
  defaultHostId: ExecutionHostId
  /** null unless the sidebar hides workspaces created from other devices. */
  hiddenOtherDevicePairings: ReadonlyMap<string, string> | null
  tabsByWorktree?: Readonly<Record<string, readonly Pick<TerminalTab, 'id'>[]>>
  unifiedTabsByWorktree?: Readonly<
    Record<
      string,
      readonly (Pick<Tab, 'id' | 'contentType'> & Partial<Pick<Tab, 'entityId' | 'worktreeId'>>)[]
    >
  >
  unreadAgentCompletionCountByPane?: Readonly<Record<string, number>>
  unreadTerminalTabs?: Readonly<Record<string, StoredAgentAttentionUnread>>
}

export function hasUnreadFolderTab(
  sources: Pick<
    UnreadBadgeCountSources,
    'tabsByWorktree' | 'unifiedTabsByWorktree' | 'unreadTerminalTabs'
  >,
  key: string
): boolean {
  return Boolean(
    sources.tabsByWorktree?.[key]?.some((tab) => sources.unreadTerminalTabs?.[tab.id]) ||
    sources.unifiedTabsByWorktree?.[key]?.some(
      (tab) => tab.contentType === 'agent-session' && sources.unreadTerminalTabs?.[tab.id]
    )
  )
}

/** Workspace flags clear on a visit; tab markers can outlive that visit or their owner. */
export function getUnreadBadgeCount(sources: UnreadBadgeCountSources): number {
  const { visibleHostIds, defaultHostId } = sources
  // Preserve the existing id-only count while narrowing it to visible hosts.
  const unreadWorktrees = new Set<string>()
  for (const worktrees of Object.values(sources.worktreesByRepo)) {
    for (const worktree of worktrees) {
      // Why: the sidebar never renders an archived worktree, nor one on a host it is not showing.
      if (
        worktree.isUnread &&
        !worktree.isArchived &&
        (!sources.hiddenOtherDevicePairings ||
          !isWorkspaceFromOtherDevice(worktree, sources.hiddenOtherDevicePairings)) &&
        worktreeMatchesVisibleHost(worktree, visibleHostIds, sources.repoMap, defaultHostId)
      ) {
        unreadWorktrees.add(worktree.id)
      }
    }
  }
  return countUnreadWithCompletions(sources, unreadWorktrees) + countUnreadFolderRows(sources)
}

/** Folder workspaces through the same membership steps the sidebar runs before building rows. */
function countUnreadFolderRows(sources: UnreadBadgeCountSources): number {
  const { projectGroups, visibleHostIds, defaultHostId, hiddenOtherDevicePairings } = sources
  const unread = sources.folderWorkspaces.filter(
    (folder) => folder.isUnread && hasUnreadFolderTab(sources, folderWorkspaceKey(folder.id))
  )
  if (unread.length === 0) {
    return 0
  }
  const onVisibleHosts = filterFolderWorkspacesForVisibleHosts(
    unread,
    projectGroups,
    visibleHostIds,
    defaultHostId
  )
  const rows = getRenderableFolderWorkspaces(
    hiddenOtherDevicePairings
      ? filterFolderWorkspacesFromOtherDevices(onVisibleHosts, hiddenOtherDevicePairings)
      : onVisibleHosts,
    filterProjectGroupsForVisibleHosts(projectGroups, visibleHostIds, defaultHostId)
  )
  return new Set(rows.map(({ folderWorkspace }) => folderWorkspace.id)).size
}

function countUnreadWithCompletions(sources: UnreadBadgeCountSources, unread: Set<string>): number {
  const completedWorkspaces = new Set<string>()
  const owners = new Map<string, string>()
  for (const [workspaceId, tabs] of Object.entries(sources.tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      owners.set(tab.id, workspaceId)
    }
  }
  for (const [workspaceId, tabs] of Object.entries(sources.unifiedTabsByWorktree ?? {})) {
    for (const tab of tabs) {
      owners.set(tab.id, workspaceId)
      if (tab.entityId) {
        owners.set(tab.entityId, tab.worktreeId || workspaceId)
      }
    }
  }
  const known = new Map(
    Object.values(sources.worktreesByRepo)
      .flat()
      .map((worktree) => [worktree.id, worktree])
  )
  let completions = 0
  for (const [paneKey, count] of Object.entries(sources.unreadAgentCompletionCountByPane ?? {})) {
    if (!Number.isFinite(count) || count <= 0) {
      continue
    }
    const separator = paneKey.indexOf(':')
    const tabId = separator === -1 ? paneKey : paneKey.slice(0, separator)
    const workspaceId = owners.get(tabId)
    const worktree = workspaceId ? known.get(workspaceId) : undefined
    if (
      worktree &&
      (worktree.isArchived ||
        !worktreeMatchesVisibleHost(
          worktree,
          sources.visibleHostIds,
          sources.repoMap,
          sources.defaultHostId
        ) ||
        (sources.hiddenOtherDevicePairings &&
          isWorkspaceFromOtherDevice(worktree, sources.hiddenOtherDevicePairings)))
    ) {
      continue
    }
    completions += Math.trunc(count)
    if (workspaceId) {
      completedWorkspaces.add(workspaceId)
    }
  }
  for (const workspaceId of completedWorkspaces) {
    unread.delete(workspaceId)
  }
  return unread.size + completions
}
