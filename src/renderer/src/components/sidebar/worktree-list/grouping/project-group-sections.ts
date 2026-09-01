import {
  compareFolderWorkspacesForDisplay,
  type RenderableFolderWorkspace
} from './folder-workspace-lanes'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { ProjectOrderBy } from '../../../../../../shared/ui-chrome-types'
import { getEffectiveProjectGroupManualRank } from '../../../../../../shared/project-groups'
import { PROJECT_GROUP_META, getProjectGroupHeaderKey } from './group-keys'
import { appendOrderedGroups } from './group-sections'
import type { SectionAppendContext } from './group-sections'
import type { OrderedGroupEntry } from './project-grouping'
import {
  compareRecentRank,
  recentRankForEntry,
  withRepoSectionDisplayLabels
} from './section-order'
import { buildFolderWorkspaceRow } from './row-builders'
import { translate } from '@/i18n/i18n'

export function appendProjectGroupSections(
  ctx: SectionAppendContext,
  args: {
    orderedGroups: OrderedGroupEntry[]
    projectGroups: readonly ProjectGroup[]
    folderWorkspaces: readonly RenderableFolderWorkspace[]
    projectOrderBy: ProjectOrderBy
    repoOrder: Map<string, number> | undefined
    /** Keep repos without a persisted group inside an explicit derived space. */
    showUngroupedProjectGroup?: boolean
  }
): void {
  const {
    orderedGroups,
    projectGroups,
    folderWorkspaces,
    projectOrderBy,
    repoOrder,
    showUngroupedProjectGroup = false
  } = args
  const { result, collapsedGroups } = ctx

  const groupByProjectGroupId = new Map<string | null, OrderedGroupEntry[]>()
  for (const entry of orderedGroups) {
    const repo = entry[1].repo
    const projectGroupId = repo?.projectGroupId ?? null
    const list = groupByProjectGroupId.get(projectGroupId) ?? []
    list.push(entry)
    groupByProjectGroupId.set(projectGroupId, list)
  }

  const sortRepoEntriesWithinGroup = (entries: OrderedGroupEntry[]): OrderedGroupEntry[] => {
    if (projectOrderBy === 'recent') {
      return [...entries].sort((left, right) =>
        compareRecentRank(recentRankForEntry(left), recentRankForEntry(right))
      )
    }
    // Manual: within a Project Group, projects order by their per-group rank
    // (projectGroupOrder), falling back to global repoOrder when unset so drag
    // midpoint commits and the rendered order stay aligned.
    return [...entries].sort((left, right) => {
      const leftRank = getEffectiveProjectGroupManualRank(left[1].repo, repoOrder)
      const rightRank = getEffectiveProjectGroupManualRank(right[1].repo, repoOrder)
      return leftRank - rightRank
    })
  }

  const projectGroupsById = new Map(projectGroups.map((group) => [group.id, group]))
  // Membership already decided by getRenderableFolderWorkspaces in buildRows, so
  // repo grouping no longer owns the filter — it only groups and orders (#15362).
  const folderWorkspacesByProjectGroupId = new Map<string, RenderableFolderWorkspace[]>()
  for (const pair of folderWorkspaces) {
    const groupId = pair.folderWorkspace.projectGroupId
    const list = folderWorkspacesByProjectGroupId.get(groupId) ?? []
    list.push(pair)
    folderWorkspacesByProjectGroupId.set(groupId, list)
  }
  for (const list of folderWorkspacesByProjectGroupId.values()) {
    list.sort((left, right) =>
      compareFolderWorkspacesForDisplay(left.folderWorkspace, right.folderWorkspace)
    )
  }
  const childGroupsByParentId = new Map<string | null, ProjectGroup[]>()
  for (const group of projectGroups) {
    const parentId =
      group.parentGroupId && projectGroupsById.has(group.parentGroupId) ? group.parentGroupId : null
    const children = childGroupsByParentId.get(parentId) ?? []
    children.push(group)
    childGroupsByParentId.set(parentId, children)
  }
  for (const groups of childGroupsByParentId.values()) {
    groups.sort(
      (left, right) => left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
    )
  }

  // Compute group aggregates once. The previous per-header recursion repeated
  // subtree walks and rescanned the full repo catalog for every group.
  const directRepoGroupIds = new Set<string>()
  for (const [groupId, entries] of groupByProjectGroupId) {
    if (groupId && entries.length > 0) {
      directRepoGroupIds.add(groupId)
    }
  }
  for (const repo of ctx.repoMap.values()) {
    if (repo.projectGroupId) {
      directRepoGroupIds.add(repo.projectGroupId)
    }
  }
  const subtreeCountByGroupId = new Map<string, number>()
  const hasRepositorySourceByGroupId = new Map<string, boolean>()
  const aggregateVisiting = new Set<string>()
  const computeGroupAggregates = (groupId: string): void => {
    if (subtreeCountByGroupId.has(groupId) || aggregateVisiting.has(groupId)) {
      return
    }
    aggregateVisiting.add(groupId)
    let subtreeCount =
      (groupByProjectGroupId.get(groupId)?.length ?? 0) +
      (folderWorkspacesByProjectGroupId.get(groupId)?.length ?? 0)
    let hasRepositorySource = directRepoGroupIds.has(groupId)
    for (const child of childGroupsByParentId.get(groupId) ?? []) {
      computeGroupAggregates(child.id)
      subtreeCount += subtreeCountByGroupId.get(child.id) ?? 0
      hasRepositorySource ||= hasRepositorySourceByGroupId.get(child.id) ?? false
    }
    aggregateVisiting.delete(groupId)
    subtreeCountByGroupId.set(groupId, subtreeCount)
    hasRepositorySourceByGroupId.set(groupId, hasRepositorySource)
  }
  for (const projectGroup of projectGroups) {
    computeGroupAggregates(projectGroup.id)
  }

  const appendProjectGroup = (projectGroup: ProjectGroup, depth: number): void => {
    const repoEntries = sortRepoEntriesWithinGroup(groupByProjectGroupId.get(projectGroup.id) ?? [])
    const childGroups = childGroupsByParentId.get(projectGroup.id) ?? []
    const key = getProjectGroupHeaderKey(projectGroup.id)
    result.push({
      type: 'header',
      key,
      label: projectGroup.name,
      count: subtreeCountByGroupId.get(projectGroup.id) ?? 0,
      tone: PROJECT_GROUP_META.tone,
      icon: PROJECT_GROUP_META.icon,
      projectGroup,
      projectGroupDepth: depth,
      hasRepositorySource: hasRepositorySourceByGroupId.get(projectGroup.id) ?? false
    })
    if (!collapsedGroups.has(key)) {
      for (const pair of folderWorkspacesByProjectGroupId.get(projectGroup.id) ?? []) {
        result.push(buildFolderWorkspaceRow(pair, depth + 1))
      }
      appendOrderedGroups(ctx, withRepoSectionDisplayLabels(repoEntries), depth + 1)
      for (const childGroup of childGroups) {
        appendProjectGroup(childGroup, depth + 1)
      }
    }
    groupByProjectGroupId.delete(projectGroup.id)
  }

  for (const projectGroup of childGroupsByParentId.get(null) ?? []) {
    appendProjectGroup(projectGroup, 0)
  }

  const remainingRepoEntries = [...(groupByProjectGroupId.get(null) ?? [])]
  for (const [projectGroupId, entries] of groupByProjectGroupId) {
    if (projectGroupId === null || projectGroupsById.has(projectGroupId)) {
      continue
    }
    // Why: startup can have repos from hosts whose project-group metadata was
    // not fetched yet; missing metadata must not make those repos disappear.
    remainingRepoEntries.push(...entries)
  }

  // A repo can arrive before its ProjectGroup metadata (or intentionally have
  // no group at all). Keep that state visible as a real, derived space instead
  // of flattening it beside persisted spaces. The null id is presentation-only
  // and is never sent to group mutations.
  if (showUngroupedProjectGroup && remainingRepoEntries.length > 0) {
    const key = getProjectGroupHeaderKey(null)
    const label = translate('components.desktopHome.ungrouped', 'Ungrouped')
    const count = remainingRepoEntries.reduce(
      (total, [, entry]) => total + entry.items.length + (entry.folderWorkspaces?.length ?? 0),
      0
    )
    result.push({
      type: 'header',
      key,
      label,
      count,
      tone: PROJECT_GROUP_META.tone,
      icon: PROJECT_GROUP_META.icon,
      projectGroup: { id: null, name: label, tabOrder: Number.MAX_SAFE_INTEGER },
      projectGroupDepth: 0,
      hasRepositorySource: true
    })
    if (!collapsedGroups.has(key)) {
      appendOrderedGroups(
        ctx,
        withRepoSectionDisplayLabels(sortRepoEntriesWithinGroup(remainingRepoEntries)),
        1
      )
    }
    return
  }

  appendOrderedGroups(
    ctx,
    withRepoSectionDisplayLabels(sortRepoEntriesWithinGroup(remainingRepoEntries)),
    0
  )
}
