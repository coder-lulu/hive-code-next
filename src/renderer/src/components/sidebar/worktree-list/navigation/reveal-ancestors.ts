import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { PINNED_GROUP_KEY, getProjectGroupHeaderKey } from '../grouping/group-keys'
import type { ProjectGroupingModel } from '../grouping/project-grouping'
import { getProjectGroupIdentity } from '../grouping/folder-workspace-lanes'

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
}): string[] {
  if (args.rowKey.startsWith('project-group:')) {
    const group = args.projectGroups.find(
      (candidate) => getProjectGroupHeaderKey(candidate.id, candidate) === args.rowKey
    )
    return getProjectGroupAncestorKeys(group?.parentGroupId, args.projectGroups, group)
  }
  const keys = new Set<string>()
  for (const repoId of getRepoIdsFromHeaderRowKey(
    args.rowKey,
    args.repoMap,
    args.projectGrouping
  )) {
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
