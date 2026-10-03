import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId
} from '../../../../../../shared/execution-host'
import { Folder } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  getProjectSetupRuntimeOwnerEnvironmentId,
  isOfflineRuntimeOwner
} from '@/lib/runtime-offline-directory'
import { buildRows } from './build-rows'
import { getProjectGroupIdentity, getRenderableFolderWorkspaces } from './folder-workspace-lanes'
import {
  getFolderWorkspaceExecutionHostIdForRows,
  getProjectGroupExecutionHostIdForRows
} from '../listing/host-filtering'
import type { Row } from './row-types'
import type { HostSectionRow } from '../../host-section-rows'
import { OFFLINE_RUNTIME_GROUP_KEY } from './group-keys'

/** Split source membership first so collapsed groups, pinned lanes and counts remain correct. */
export function buildRuntimeOfflineRows(
  args: Parameters<typeof buildRows>,
  offlineEnvironmentIds: ReadonlySet<string>
): { onlineRows: Row[]; offlineRows: Row[]; offlineCount: number } {
  if (offlineEnvironmentIds.size === 0) {
    return { onlineRows: buildRows(...args), offlineRows: [], offlineCount: 0 }
  }
  const worktrees = args[1]
  const repoMap = args[2]
  const projectGroups = args[12] ?? []
  const folders = getRenderableFolderWorkspaces(args[18] ?? [], projectGroups)
  const defaultHostId = args[20] ?? 'local'
  const setupByRepoId = new Map(args[17]?.projectHostSetups.map((setup) => [setup.repoId, setup]))
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
    const scoped: Parameters<typeof buildRows> = [...args]
    scoped[1] = worktrees.filter(
      (worktree) =>
        isOfflineRuntimeOwner(
          getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId),
          offlineEnvironmentIds,
          worktree.runtimeOwnerEnvironmentId ?? repoRuntimeOwner(worktree.repoId)
        ) === offline
    )
    const worktreeRepoIds = new Set(scoped[1].map((worktree) => worktree.repoId))
    scoped[2] = new Map(
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
      ...[...scoped[2].values()].flatMap((repo) =>
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
    scoped[12] = projectGroups.filter((group) => includedGroups.has(getProjectGroupIdentity(group)))
    scoped[13] = new Set([...(args[13] ?? [])].filter((id) => repoIsOffline(id) === offline))
    scoped[14] = new Map([...(args[14] ?? [])].filter(([id]) => repoIsOffline(id) === offline))
    scoped[15] = new Map([...(args[15] ?? [])].filter(([id]) => repoIsOffline(id) === offline))
    scoped[16] = args[16]?.filter((creation) => repoIsOffline(creation.repoId) === offline)
    scoped[18] = scopedFolders.map((pair) => pair.folderWorkspace)
    return scoped
  }
  const onlineArgs = partition(false)
  const offlineArgs = partition(true)
  const offlineRows = buildRows(...offlineArgs).map((row): Row =>
    row.type === 'header' ? { ...row, renderKey: `${OFFLINE_RUNTIME_GROUP_KEY}:${row.key}` } : row
  )
  const occupiedRepoIds = new Set(offlineArgs[1].map((worktree) => worktree.repoId))
  const offlineCount =
    offlineRows.length === 0
      ? 0
      : Math.max(
          1,
          offlineArgs[1].length +
            (offlineArgs[18]?.length ?? 0) +
            [...(offlineArgs[13] ?? [])].filter((id) => !occupiedRepoIds.has(id)).length
        )
  return { onlineRows: buildRows(...onlineArgs), offlineRows, offlineCount }
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
    tone: 'text-muted-foreground',
    icon: Folder
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
