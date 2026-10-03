import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../../../shared/worktree/types'
import { folderWorkspaceToWorktree } from '../../../../../../shared/folder-workspace-worktree'
import { parseWorkspaceKey } from '../../../../../../shared/workspace-scope'
import { OFFLINE_RUNTIME_GROUP_KEY, getProjectGroupHeaderKey } from '../grouping/group-keys'
import { isOfflineRuntimeOwner } from '@/lib/runtime-offline-directory'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import {
  getFolderWorkspaceLaneKey,
  getProjectGroupIdentity,
  getRenderableFolderWorkspaces
} from '../grouping/folder-workspace-lanes'
import type { WorktreeGroupBy } from '../grouping/row-types'
import { getFolderWorkspaceHostId } from '../../folder-workspace-host-id'

function findFolderWorkspaceByKey(
  worktreeId: string,
  folderWorkspaces: readonly FolderWorkspace[]
): FolderWorkspace | null {
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type !== 'folder') {
    return null
  }
  return folderWorkspaces.find((workspace) => workspace.id === scope.folderWorkspaceId) ?? null
}

export function getKnownSidebarWorktreeById(
  worktreeId: string,
  worktreeMap: ReadonlyMap<string, Worktree>,
  folderWorkspaces: readonly FolderWorkspace[],
  worktrees?: readonly Worktree[],
  executionHostId?: ExecutionHostId | null
): Worktree | null {
  const worktree = executionHostId
    ? (worktrees?.find(
        (candidate) => candidate.id === worktreeId && candidate.hostId === executionHostId
      ) ?? null)
    : worktreeMap.get(worktreeId)
  if (worktree) {
    return worktree
  }
  const folderWorkspace = findFolderWorkspaceByKey(worktreeId, folderWorkspaces)
  return folderWorkspace ? folderWorkspaceToWorktree(folderWorkspace) : null
}

export function sidebarWorkspaceStillExists(
  worktreeId: string,
  worktrees: readonly Worktree[],
  folderWorkspaces: readonly FolderWorkspace[],
  executionHostId?: ExecutionHostId
): boolean {
  if (
    worktrees.some(
      (worktree) =>
        worktree.id === worktreeId &&
        (!executionHostId || !worktree.hostId || worktree.hostId === executionHostId)
    )
  ) {
    return true
  }
  return findFolderWorkspaceByKey(worktreeId, folderWorkspaces) !== null
}

export function getFolderWorkspaceRevealGroupKeys(
  worktreeId: string,
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[],
  options?: {
    groupBy?: WorktreeGroupBy
    workspaceStatuses?: readonly WorkspaceStatusDefinition[]
    defaultHostId?: ExecutionHostId
    executionHostId?: ExecutionHostId
    offlineRuntimeEnvironmentIds?: ReadonlySet<string>
  }
): string[] {
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type !== 'folder') {
    return []
  }
  const pair = getRenderableFolderWorkspaces(
    folderWorkspaces.filter((workspace) => workspace.id === scope.folderWorkspaceId),
    projectGroups
  ).find(
    ({ folderWorkspace, projectGroup }) =>
      !options?.executionHostId ||
      getFolderWorkspaceHostId(folderWorkspace, projectGroup, options.defaultHostId ?? 'local') ===
        options.executionHostId
  )
  if (!pair) {
    return []
  }
  const { folderWorkspace, projectGroup: owningGroup } = pair
  const groupsById = new Map(projectGroups.map((group) => [getProjectGroupIdentity(group), group]))
  const keys: string[] = []
  const seen = new Set<string>()
  let groupId: string | null = folderWorkspace.projectGroupId
  while (groupId && !seen.has(groupId)) {
    seen.add(groupId)
    const group = owningGroup && groupsById.get(getProjectGroupIdentity(owningGroup, groupId))
    if (!group) {
      break
    }
    keys.unshift(getProjectGroupHeaderKey(group.id, group))
    groupId = group.parentGroupId
  }

  if (
    options?.offlineRuntimeEnvironmentIds &&
    isOfflineRuntimeOwner(
      getFolderWorkspaceHostId(folderWorkspace, owningGroup, options.defaultHostId ?? 'local'),
      options.offlineRuntimeEnvironmentIds
    )
  ) {
    keys.unshift(OFFLINE_RUNTIME_GROUP_KEY)
  }

  // Under non-repo grouping the project-group headers above do not exist, so the
  // lane and host headers are the ones actually hiding the row (#15362). Lane
  // keys come from the same function grouping uses, so the two cannot disagree.
  if (options?.groupBy && options.groupBy !== 'repo' && owningGroup) {
    keys.push(
      getFolderWorkspaceLaneKey(
        { folderWorkspace, projectGroup: owningGroup },
        options.groupBy,
        options.workspaceStatuses ?? []
      )
    )
  }
  if (owningGroup && options?.defaultHostId) {
    keys.push(
      `host:${getFolderWorkspaceHostId(folderWorkspace, owningGroup, options.defaultHostId)}`
    )
  }
  return keys
}
