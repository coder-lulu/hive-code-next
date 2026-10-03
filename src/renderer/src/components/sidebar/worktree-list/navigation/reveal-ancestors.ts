import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import {
  OFFLINE_RUNTIME_GROUP_KEY,
  PINNED_GROUP_KEY,
  getProjectGroupHeaderKey
} from '../grouping/group-keys'
import { getRepoExecutionHostId } from '../../../../../../shared/execution-host'
import {
  getProjectSetupRuntimeOwnerEnvironmentId,
  isOfflineRuntimeOwner
} from '@/lib/runtime-offline-directory'
import type { ProjectGroupingModel } from '../grouping/project-grouping'
import { getProjectGroupIdentity } from '../grouping/folder-workspace-lanes'
import { getProjectGroupHostId } from '@/store/slices/project-group-owner-routing'

function getProjectIdFromHeaderRowKey(rowKey: string): string | null {
  if (!rowKey.startsWith('project:')) {
    return null
  }
  const withoutPrefix = rowKey.slice('project:'.length)
  const setupSeparator = withoutPrefix.indexOf('::setup:')
  return setupSeparator === -1 ? withoutPrefix : withoutPrefix.slice(0, setupSeparator)
}

function getRepoIdsFromHeaderRowKey(
  rowKey: string,
  repoMap: Map<string, Repo>,
  projectGrouping?: ProjectGroupingModel
): string[] {
  if (rowKey.startsWith('repo:')) {
    return [rowKey.slice('repo:'.length)]
  }
  const setupMarker = '::setup:'
  const setupIndex = rowKey.indexOf(setupMarker)
  if (rowKey.startsWith('project:') && setupIndex !== -1) {
    return [rowKey.slice(setupIndex + setupMarker.length)]
  }
  const projectId = getProjectIdFromHeaderRowKey(rowKey)
  if (!projectId) {
    return []
  }
  const repoIds = new Set<string>()
  for (const setup of projectGrouping?.projectHostSetups ?? []) {
    if (setup.projectId === projectId && repoMap.has(setup.repoId)) {
      repoIds.add(setup.repoId)
    }
  }
  const project = projectGrouping?.projects.find((candidate) => candidate.id === projectId)
  for (const repoId of project?.sourceRepoIds ?? []) {
    if (repoMap.has(repoId)) {
      repoIds.add(repoId)
    }
  }
  return [...repoIds]
}

function getProjectGroupAncestorKeys(
  projectGroupId: string | null | undefined,
  projectGroups: readonly ProjectGroup[],
  owner?: Pick<ProjectGroup, 'id' | 'executionHostId' | 'connectionId'>
): string[] {
  const groupsById = new Map(projectGroups.map((group) => [getProjectGroupIdentity(group), group]))
  const keys: string[] = []
  const seen = new Set<string>()
  let currentGroupId = projectGroupId ?? null
  while (currentGroupId && !seen.has(currentGroupId)) {
    const group = groupsById.get(
      getProjectGroupIdentity(owner ?? { id: currentGroupId }, currentGroupId)
    )
    if (!group) {
      break
    }
    seen.add(currentGroupId)
    keys.unshift(getProjectGroupHeaderKey(group.id, group))
    currentGroupId = group.parentGroupId
  }
  return keys
}

export function getSidebarRowRevealAncestorKeys(args: {
  rowKey: string
  repoMap: Map<string, Repo>
  projectGroups: readonly ProjectGroup[]
  projectGrouping?: ProjectGroupingModel
  offlineRuntimeEnvironmentIds: ReadonlySet<string>
}): string[] {
  const offlinePrefix = `${OFFLINE_RUNTIME_GROUP_KEY}:`
  const explicitOffline = args.rowKey.startsWith(offlinePrefix)
  const rowKey = explicitOffline ? args.rowKey.slice(offlinePrefix.length) : args.rowKey
  const keys = new Set<string>(explicitOffline ? [OFFLINE_RUNTIME_GROUP_KEY] : [])
  if (rowKey.startsWith('project-group:')) {
    const group = args.projectGroups.find(
      (candidate) => getProjectGroupHeaderKey(candidate.id, candidate) === rowKey
    )
    if (
      group &&
      isOfflineRuntimeOwner(getProjectGroupHostId(group), args.offlineRuntimeEnvironmentIds)
    ) {
      keys.add(OFFLINE_RUNTIME_GROUP_KEY)
    }
    return [
      ...keys,
      ...getProjectGroupAncestorKeys(group?.parentGroupId, args.projectGroups, group)
    ]
  }
  const repoIds = getRepoIdsFromHeaderRowKey(rowKey, args.repoMap, args.projectGrouping)
  if (
    repoIds.some((repoId) => {
      const repo = args.repoMap.get(repoId)
      const setup = args.projectGrouping?.projectHostSetups.find((setup) => setup.repoId === repoId)
      return (
        repo &&
        isOfflineRuntimeOwner(
          getRepoExecutionHostId(repo),
          args.offlineRuntimeEnvironmentIds,
          getProjectSetupRuntimeOwnerEnvironmentId(setup)
        )
      )
    })
  ) {
    keys.add(OFFLINE_RUNTIME_GROUP_KEY)
  }
  for (const repoId of repoIds) {
    const repo = args.repoMap.get(repoId)
    for (const key of getProjectGroupAncestorKeys(repo?.projectGroupId, args.projectGroups, repo)) {
      keys.add(key)
    }
  }
  return [...keys]
}

export function getPinnedWorktreeRevealCollapsedGroupKeys({
  worktree,
  collapsedGroups,
  inPinnedSection = worktree.isPinned
}: {
  worktree: Worktree
  collapsedGroups: ReadonlySet<string>
  inPinnedSection?: boolean
}): string[] {
  if (!inPinnedSection) {
    return []
  }
  const keys: string[] = []
  // Why: the reveal effect already opens this host; re-returning it would toggle it back closed.
  if (collapsedGroups.has(PINNED_GROUP_KEY)) {
    keys.push(PINNED_GROUP_KEY)
  }
  return keys
}
