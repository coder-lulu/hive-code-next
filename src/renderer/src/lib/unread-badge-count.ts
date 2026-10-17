import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts
} from '@/components/sidebar/worktree-list/listing/host-filtering'
import { getRenderableFolderWorkspaces } from '@/components/sidebar/worktree-list/grouping/folder-workspace-lanes'
import { worktreeMatchesVisibleHost } from '@/components/sidebar/visible-worktree-host-scope'
import {
  filterFolderWorkspacesFromOtherDevices,
  isWorkspaceOwnedBySomeoneElse
} from '../../../shared/workspace-creator-visibility'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import type { StoredAgentAttentionUnread } from '@/attention/agent-attention-contract'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { Tab } from '../../../shared/tab-types'
import type { Worktree } from '../../../shared/worktree/types'
import { hasLiveTabMarker } from '@/store/slices/workspace-attention/workspace-live-markers'

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

/** Folder rows also need a live tab marker; worktree rows count their flag alone. */
export function getUnreadBadgeCount(sources: UnreadBadgeCountSources): number {
  const { visibleHostIds, defaultHostId } = sources
  // Preserve the existing id-only count while narrowing it to visible hosts.
  const unreadWorkspaces = new Set<string>()
  const visibleWorkspaces = new Set<string>()
  for (const worktrees of Object.values(sources.worktreesByRepo)) {
    for (const worktree of worktrees) {
      // Why: the sidebar never renders an archived worktree, nor one on a host it is not showing.
      if (
        !worktree.isArchived &&
        (!sources.hiddenOtherDevicePairings ||
          !isWorkspaceOwnedBySomeoneElse(worktree, sources.hiddenOtherDevicePairings)) &&
        worktreeMatchesVisibleHost(worktree, visibleHostIds, sources.repoMap, defaultHostId)
      ) {
        visibleWorkspaces.add(worktree.id)
        if (worktree.isUnread) {
          unreadWorkspaces.add(worktree.id)
        }
      }
    }
  }
  for (const { folderWorkspace } of renderableFolders(sources)) {
    const workspaceId = folderWorkspaceKey(folderWorkspace.id)
    visibleWorkspaces.add(workspaceId)
    if (folderWorkspace.isUnread && hasLiveTabMarker(sources, workspaceId)) {
      unreadWorkspaces.add(workspaceId)
    }
  }
  return countUnreadWithCompletions(sources, unreadWorkspaces, visibleWorkspaces)
}

/** Folder workspaces through the same membership steps the sidebar runs before building rows. */
function renderableFolders(sources: UnreadBadgeCountSources) {
  const { projectGroups, visibleHostIds, defaultHostId, hiddenOtherDevicePairings } = sources
  const onVisibleHosts = filterFolderWorkspacesForVisibleHosts(
    sources.folderWorkspaces,
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
  return rows
}

function countUnreadWithCompletions(
  sources: UnreadBadgeCountSources,
  unread: Set<string>,
  visibleWorkspaces: ReadonlySet<string>
): number {
  const completedWorkspaces = new Set<string>()
  const owners = new Map<string, string>()
  for (const [workspaceId, tabs] of Object.entries(sources.tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      owners.set(tab.id, workspaceId)
    }
  }
  for (const [workspaceId, tabs] of Object.entries(sources.unifiedTabsByWorktree ?? {})) {
    for (const tab of tabs) {
      if (tab.contentType !== 'terminal' && tab.contentType !== 'agent-session') {
        continue
      }
      owners.set(tab.id, workspaceId)
      if (tab.entityId) {
        owners.set(tab.entityId, tab.worktreeId || workspaceId)
      }
    }
  }
  let completions = 0
  for (const [paneKey, count] of Object.entries(sources.unreadAgentCompletionCountByPane ?? {})) {
    if (!Number.isFinite(count) || count <= 0) {
      continue
    }
    const separator = paneKey.indexOf(':')
    const tabId = separator === -1 ? paneKey : paneKey.slice(0, separator)
    const workspaceId = owners.get(tabId)
    // Retained counters are data, not proof that a navigable sidebar owner still exists.
    if (!workspaceId || !visibleWorkspaces.has(workspaceId)) {
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
