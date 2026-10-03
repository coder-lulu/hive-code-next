import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../shared/execution-host'
import { getProjectGroupHeaderKey } from '../sidebar/worktree-list/grouping/group-keys'
import type {
  DesktopHomeProjectGroup,
  DesktopHomeProject,
  DesktopHomeWorkspace
} from './desktop-home-model-types'
import type { HomeGroup } from './desktop-home-model-utils'
import {
  compareGroup,
  compareProject,
  compareWorkspace,
  groupHost,
  groupIdentity
} from './desktop-home-model-utils'

export function createGroupProjection(
  source: HomeGroup,
  collapsedGroups: ReadonlySet<string> | undefined
): DesktopHomeProjectGroup {
  const executionHostId = groupHost(source)
  const collapseKey = getProjectGroupHeaderKey(source.id)
  return {
    id: source.id,
    identityKey: groupIdentity(executionHostId, source.id),
    name: source.name,
    parentPath: source.parentPath ?? null,
    parentGroupId: source.parentGroupId,
    childGroups: [],
    projects: [],
    folderWorkspaces: [],
    workspaceCount: 0,
    collapseKey,
    // `ProjectGroup.isCollapsed` is persisted source data. The homepage uses
    // the same resolved UI set as Sidebar grouping instead.
    isCollapsed: collapsedGroups?.has(collapseKey) ?? false,
    executionHostId,
    hasExplicitHost: Boolean(source.executionHostId?.trim() || source.connectionId?.trim()),
    color: source.color ?? null,
    tabOrder: source.tabOrder
  }
}

export function buildGroupTree(
  sources: readonly HomeGroup[],
  groupsByIdentity: Map<string, DesktopHomeProjectGroup>,
  collapsedGroups: ReadonlySet<string> | undefined
): { roots: DesktopHomeProjectGroup[]; ungrouped: DesktopHomeProjectGroup } {
  const sourceByIdentity = new Map<string, HomeGroup>()
  for (const source of sources) {
    sourceByIdentity.set(groupIdentity(groupHost(source), source.id), source)
  }
  const childrenByParent = new Map<string | null, DesktopHomeProjectGroup[]>()
  for (const group of groupsByIdentity.values()) {
    const parent = group.parentGroupId
      ? sourceByIdentity.has(groupIdentity(group.executionHostId, group.parentGroupId))
        ? groupIdentity(group.executionHostId, group.parentGroupId)
        : null
      : null
    const children = childrenByParent.get(parent) ?? []
    children.push(group)
    childrenByParent.set(parent, children)
  }
  for (const children of childrenByParent.values()) {
    children.sort(compareGroup)
  }

  const visited = new Set<string>()
  const materialize = (group: DesktopHomeProjectGroup): DesktopHomeProjectGroup => {
    if (visited.has(group.identityKey)) {
      return { ...group, childGroups: [] }
    }
    visited.add(group.identityKey)
    return {
      ...group,
      childGroups: (childrenByParent.get(group.identityKey) ?? []).map(materialize)
    }
  }
  const roots = (childrenByParent.get(null) ?? []).map(materialize)
  // Broken parent references and cycles must remain visible rather than being
  // silently dropped from the home tree.
  for (const group of groupsByIdentity.values()) {
    if (!visited.has(group.identityKey)) {
      roots.push(materialize(group))
    }
  }
  roots.sort(compareGroup)

  const ungrouped: DesktopHomeProjectGroup = {
    id: '__ungrouped__',
    identityKey: '__ungrouped__',
    name: 'Ungrouped',
    parentPath: null,
    parentGroupId: null,
    childGroups: [],
    projects: [],
    folderWorkspaces: [],
    workspaceCount: 0,
    collapseKey: getProjectGroupHeaderKey(null),
    isCollapsed: collapsedGroups?.has(getProjectGroupHeaderKey(null)) ?? false,
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    hasExplicitHost: false,
    color: null,
    tabOrder: Number.MAX_SAFE_INTEGER
  }
  return { roots, ungrouped }
}

export function findGroupForEntity(
  groupsByIdentity: Map<string, DesktopHomeProjectGroup>,
  id: string | null | undefined,
  host: ExecutionHostId
): DesktopHomeProjectGroup | null {
  if (!id) {
    return null
  }
  const exact = groupsByIdentity.get(groupIdentity(host, id))
  if (exact) {
    return exact
  }
  // Legacy rows may omit host information. Only use an unambiguous fallback;
  // never attach a remote entity to an arbitrary same-named host group.
  const candidates = [...groupsByIdentity.values()].filter(
    (group) => group.id === id && !group.hasExplicitHost
  )
  return candidates.length === 1 ? candidates[0] : null
}

export function updateGroupCounts(group: DesktopHomeProjectGroup): number {
  group.projects.sort(compareProject)
  group.folderWorkspaces.sort(compareWorkspace)
  const childCount = group.childGroups.reduce((count, child) => count + updateGroupCounts(child), 0)
  group.workspaceCount =
    group.projects.reduce((count, project) => count + project.workspaceCount, 0) +
    group.folderWorkspaces.length +
    childCount
  return group.workspaceCount
}

export function sortProjectWorkspaces(project: DesktopHomeProject): void {
  project.workspaces.sort(compareWorkspace)
  project.workspaceCount = project.workspaces.length
}

export function addWorkspaceToProject(
  project: DesktopHomeProject,
  workspace: DesktopHomeWorkspace,
  workspaceIdentities?: Set<string>
): void {
  if (
    workspaceIdentities
      ? workspaceIdentities.has(workspace.identityKey)
      : project.workspaces.some((entry) => entry.identityKey === workspace.identityKey)
  ) {
    return
  }
  workspaceIdentities?.add(workspace.identityKey)
  project.workspaces.push(workspace)
  project.lastActivityAt = Math.max(project.lastActivityAt, workspace.lastActivityAt)
}
