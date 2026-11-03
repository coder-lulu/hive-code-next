import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId
} from '../../../../../../shared/execution-host'
import { translate } from '@/i18n/i18n'
import {
  getProjectSetupRuntimeOwnerEnvironmentId,
  isOfflineRuntimeOwner
} from '@/lib/runtime-offline-directory'
import {
  planSidebarRows,
  type SidebarRowPlanInputs
} from '../../../../../../shared/sidebar-list/sidebar-row-plan'
import { getProjectGroupIdentity, getRenderableFolderWorkspaces } from './folder-workspace-lanes'
import {
  getFolderWorkspaceExecutionHostIdForRows,
  getProjectGroupExecutionHostIdForRows
} from '../../../../../../shared/sidebar-list/host-filtering'
import type { Row } from '../../../../../../shared/sidebar-list/row-types'
import type { HostSectionRow } from '../../../../../../shared/sidebar-list/host-section-rows'
import { OFFLINE_RUNTIME_GROUP_KEY } from './group-keys'

/** Split source membership first so collapsed groups, pinned lanes and counts remain correct. */
export function buildRuntimeOfflineRows(
  args: SidebarRowPlanInputs,
  offlineEnvironmentIds: ReadonlySet<string>,
  collapsedGroups = new Set<string>()
): { onlineRows: Row[]; offlineRows: Row[]; offlineCount: number } {
  if (offlineEnvironmentIds.size === 0) {
    return {
      onlineRows: planSidebarRows(args).render(collapsedGroups),
      offlineRows: [],
      offlineCount: 0
    }
  }
  const worktrees = args.worktrees
  const repoMap = args.repoMap
  const projectGroups = args.projectGroups ?? []
  const folders = getRenderableFolderWorkspaces(args.folderWorkspaces ?? [], projectGroups)
  const defaultHostId = args.defaultHostId ?? 'local'
  const setupByRepoId = new Map(
    args.projectGrouping?.projectHostSetups.map((setup) => [setup.repoId, setup])
  )
  const repoRuntimeOwner = (repoId: string) =>
    getProjectSetupRuntimeOwnerEnvironmentId(setupByRepoId.get(repoId))
  const repoIsOffline = (repoId: string) => {
    const repo = repoMap.get(repoId)
    return isOfflineRuntimeOwner(
      repo ? getRepoExecutionHostId(repo) : defaultHostId,
      offlineEnvironmentIds,
      repoRuntimeOwner(repoId)
    )
  }
  const partition = (offline: boolean) => {
    const scoped: SidebarRowPlanInputs = { ...args }
    scoped.worktrees = worktrees.filter(
      (worktree) =>
        isOfflineRuntimeOwner(
          getWorktreeExecutionHostId(
            worktree,
            args.repoOfWorktree?.(worktree) ?? repoMap.get(worktree.repoId),
            defaultHostId
          ),
          offlineEnvironmentIds,
          worktree.runtimeOwnerEnvironmentId ?? repoRuntimeOwner(worktree.repoId)
        ) === offline
    )
    const worktreeRepoIds = new Set(scoped.worktrees.map((worktree) => worktree.repoId))
    scoped.repoMap = new Map(
      [...repoMap].filter(([id]) => repoIsOffline(id) === offline || worktreeRepoIds.has(id))
    )
    const scopedFolders = folders.filter(
      (pair) =>
        isOfflineRuntimeOwner(
          getFolderWorkspaceExecutionHostIdForRows({ ...pair, defaultHostId }),
          offlineEnvironmentIds
        ) === offline
    )
    const includedGroups = new Set([
      ...projectGroups
        .filter(
          (group) =>
            isOfflineRuntimeOwner(
              getProjectGroupExecutionHostIdForRows(group, defaultHostId),
              offlineEnvironmentIds
            ) === offline
        )
        .map((group) => getProjectGroupIdentity(group)),
      ...scopedFolders.map((pair) => getProjectGroupIdentity(pair.projectGroup)),
      ...[...scoped.repoMap.values()].flatMap((repo) =>
        repo.projectGroupId ? [getProjectGroupIdentity(repo, repo.projectGroupId)] : []
      )
    ])
    // Keep ancestor spaces when a folder carries a more precise host stamp than its parent.
    let addedParent = true
    while (addedParent) {
      addedParent = false
      for (const group of projectGroups) {
        if (
          includedGroups.has(getProjectGroupIdentity(group)) &&
          group.parentGroupId &&
          !includedGroups.has(getProjectGroupIdentity(group, group.parentGroupId))
        ) {
          includedGroups.add(getProjectGroupIdentity(group, group.parentGroupId))
          addedParent = true
        }
      }
    }
    scoped.projectGroups = projectGroups.filter((group) =>
      includedGroups.has(getProjectGroupIdentity(group))
    )
    scoped.placeholderRepoIds = new Set(
      [...(args.placeholderRepoIds ?? [])].filter((id) => repoIsOffline(id) === offline)
    )
    scoped.importedWorktreesByRepo = new Map(
      [...(args.importedWorktreesByRepo ?? [])].filter(([id]) => repoIsOffline(id) === offline)
    )
    scoped.newExternalWorktreesInboxByRepo = new Map(
      [...(args.newExternalWorktreesInboxByRepo ?? [])].filter(
        ([id]) => repoIsOffline(id) === offline
      )
    )
    scoped.pendingCreations = args.pendingCreations?.filter(
      (creation) => repoIsOffline(creation.repoId) === offline
    )
    scoped.folderWorkspaces = scopedFolders.map((pair) => pair.folderWorkspace)
    return scoped
  }
  const onlineArgs = partition(false)
  const offlineArgs = partition(true)
  const offlineRows = planSidebarRows(offlineArgs)
    .render(collapsedGroups)
    .map((row): Row =>
      row.type === 'header'
        ? {
            ...row,
            key: `${OFFLINE_RUNTIME_GROUP_KEY}:${row.key}`,
            collapseKey: row.collapseKey ?? row.key
          }
        : row
    )
  const occupiedRepoIds = new Set(offlineArgs.worktrees.map((worktree) => worktree.repoId))
  const offlineCount =
    offlineRows.length === 0
      ? 0
      : Math.max(
          1,
          offlineArgs.worktrees.length +
            (offlineArgs.folderWorkspaces?.length ?? 0) +
            [...(offlineArgs.placeholderRepoIds ?? [])].filter((id) => !occupiedRepoIds.has(id))
              .length
        )
  return {
    onlineRows: planSidebarRows(onlineArgs).render(collapsedGroups),
    offlineRows,
    offlineCount
  }
}

export function appendRuntimeOfflineDirectory(
  onlineRows: HostSectionRow[],
  offlineRows: Row[],
  offlineCount: number,
  collapsedGroups: ReadonlySet<string>
): HostSectionRow[] {
  if (offlineRows.length === 0) {
    return onlineRows
  }
  const directory: Row = {
    type: 'header',
    key: OFFLINE_RUNTIME_GROUP_KEY,
    label: translate('components.sessions.offline', 'Offline'),
    count: offlineCount,
    icon: { kind: 'project' }
  }
  const children = collapsedGroups.has(OFFLINE_RUNTIME_GROUP_KEY)
    ? []
    : offlineRows.map((row): Row => {
        if (row.type === 'header') {
          return { ...row, projectGroupDepth: (row.projectGroupDepth ?? 0) + 1 }
        }
        if (row.type === 'item' || row.type === 'folder-workspace') {
          return { ...row, groupDepth: row.groupDepth + 1 }
        }
        return row
      })
  return [...onlineRows, directory, ...children]
}
