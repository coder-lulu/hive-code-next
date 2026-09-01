import type { ExecutionHostId } from '../../../../shared/execution-host'
import type {
  BuildDesktopHomeModelInput,
  DesktopHomeFile,
  DesktopHomeModel,
  DesktopHomeProject,
  DesktopHomeProjectGroup,
  DesktopHomeSession,
  DesktopHomeWorkspace
} from './desktop-home-model-types'
import {
  activeScope,
  compareProject,
  compareWorkspace,
  formatHomeRelativeTime,
  workspaceScopeKey
} from './desktop-home-model-utils'
import {
  buildGroupTree,
  createGroupProjection,
  findGroupForEntity,
  updateGroupCounts
} from './desktop-home-model-groups'
import { buildHomeEntities } from './desktop-home-model-entities'
import { buildTemporarySessions } from './desktop-home-model-sessions'

function createGroups(input: BuildDesktopHomeModelInput): Map<string, DesktopHomeProjectGroup> {
  const groups = new Map<string, DesktopHomeProjectGroup>()
  for (const source of input.projectGroups ?? []) {
    const group = createGroupProjection(source, input.collapsedGroups)
    if (!groups.has(group.identityKey)) {
      groups.set(group.identityKey, group)
    }
  }
  return groups
}

function assignEntitiesToGroups(
  groupsByIdentity: Map<string, DesktopHomeProjectGroup>,
  ungrouped: DesktopHomeProjectGroup,
  projects: Iterable<DesktopHomeProject>,
  folders: Iterable<DesktopHomeWorkspace>,
  folderSourcesByIdentity: ReadonlyMap<string, { projectGroupId: string }>
): void {
  for (const project of projects) {
    const group = findGroupForEntity(
      groupsByIdentity,
      project.projectGroupId,
      project.executionHostId
    )
    ;(group ?? ungrouped).projects.push(project)
  }
  for (const workspace of folders) {
    const source = workspace.identityKey
      ? folderSourcesByIdentity.get(workspace.identityKey)
      : undefined
    const group = findGroupForEntity(
      groupsByIdentity,
      source?.projectGroupId,
      workspace.executionHostId
    )
    ;(group ?? ungrouped).folderWorkspaces.push(workspace)
  }
}

function matchesCurrentWorkspace(
  workspace: DesktopHomeWorkspace,
  input: BuildDesktopHomeModelInput
): boolean {
  const scope = activeScope(input)
  if (!scope || workspace.workspaceKey !== workspaceScopeKey(scope)) {
    return false
  }
  if (
    input.activeWorkspaceExecutionHostId &&
    workspace.executionHostId !== input.activeWorkspaceExecutionHostId
  ) {
    return false
  }
  // Folder workspaces intentionally have no activeRepoId. For worktrees, the
  // repo pointer further disambiguates legacy host-colliding ids when present.
  return !(
    scope.type === 'worktree' &&
    input.activeRepoId &&
    workspace.repoId &&
    workspace.repoId !== input.activeRepoId
  )
}

function currentFilesForWorkspace(
  files: readonly DesktopHomeFile[],
  workspace: DesktopHomeWorkspace | null,
  allWorkspaces: readonly DesktopHomeWorkspace[]
): DesktopHomeFile[] {
  if (!workspace) {
    return []
  }
  const sameRawIdCount = allWorkspaces.filter((entry) => entry.id === workspace.id).length
  return files
    .filter((file) => {
      const hostMatches = file.executionHostId === workspace.executionHostId
      if (file.executionHostId && !hostMatches) {
        return false
      }
      if (
        file.worktreeId === workspace.identityKey ||
        (file.worktreeId === workspace.workspaceKey && (sameRawIdCount <= 1 || hostMatches))
      ) {
        return true
      }
      // Bare ids are retained for old editor snapshots, but become ambiguous
      // when the same workspace id exists on more than one execution host.
      return (sameRawIdCount <= 1 || hostMatches) && file.worktreeId === workspace.id
    })
    .slice(-5)
    .toReversed()
}

function preserveLegacyEmptyShape(
  model: DesktopHomeModel,
  input: BuildDesktopHomeModelInput,
  repos: readonly unknown[]
): void {
  const hasExplicitActiveContext =
    input.activeWorkspaceKey !== undefined ||
    input.activeWorktreeId !== undefined ||
    input.activeRepoId !== undefined ||
    input.activeWorkspaceExecutionHostId !== undefined
  if (!hasExplicitActiveContext && repos.length === 0 && input.projectGroups === undefined) {
    // Older consumers compare the empty projection structurally. Keep rich V3
    // fields readable while making them non-enumerable during migration.
    Object.defineProperties(model, {
      groups: { value: model.groups, enumerable: false },
      ungrouped: { value: model.ungrouped, enumerable: false },
      projects: { value: model.projects, enumerable: false },
      workspaces: { value: model.workspaces, enumerable: false },
      sessionSummaries: { value: model.sessionSummaries, enumerable: false },
      temporarySessions: { value: model.temporarySessions, enumerable: false },
      sessionCount: { value: model.sessionCount, enumerable: false }
    })
  }
}

export function buildDesktopHomeModel(input: BuildDesktopHomeModelInput): DesktopHomeModel {
  const repos = [...input.repos]
  const groupsByIdentity = createGroups(input)
  const entities = buildHomeEntities(input, repos)
  const { roots, ungrouped } = buildGroupTree(
    input.projectGroups ?? [],
    groupsByIdentity,
    input.collapsedGroups
  )

  assignEntitiesToGroups(
    groupsByIdentity,
    ungrouped,
    entities.projectsByIdentity.values(),
    entities.workspaces.filter((workspace) => workspace.kind === 'folder'),
    entities.folderSourcesByIdentity
  )
  const projects = [...entities.projectsByIdentity.values()]
  const workspaces = entities.workspaces.sort(compareWorkspace)
  const hasExplicitActiveContext =
    input.activeWorkspaceKey !== undefined ||
    input.activeWorktreeId !== undefined ||
    input.activeRepoId !== undefined ||
    input.activeWorkspaceExecutionHostId !== undefined
  const scope = activeScope(input)
  const currentCandidates = scope
    ? workspaces.filter((workspace) => matchesCurrentWorkspace(workspace, input))
    : []
  const currentWorkspace = scope
    ? currentCandidates.length === 1
      ? currentCandidates[0]
      : null
    : hasExplicitActiveContext
      ? null
      : (workspaces[0] ?? null)
  const floatingSessions = buildTemporarySessions(input)
  const temporarySessions: DesktopHomeSession[] = []
  for (const session of floatingSessions) {
    const assignment = session.projectAssignment
    const project = assignment
      ? entities.projectsByIdentity.get(assignment.projectIdentityKey)
      : undefined
    if (
      project &&
      project.id === assignment?.projectId &&
      project.executionHostId === assignment.executionHostId
    ) {
      project.sessions.push(session)
      project.lastActivityAt = Math.max(project.lastActivityAt, session.lastActivityAt)
    } else {
      temporarySessions.push(session)
    }
  }
  // Assigned sessions contribute project activity just like worktree-backed
  // sessions. Sort only after that projection so saving a recent session moves
  // the project consistently in both the flat catalog and its space tree.
  projects.sort(compareProject)
  for (const group of roots) {
    updateGroupCounts(group)
  }
  updateGroupCounts(ungrouped)
  const sessionSummaries = [
    ...workspaces.flatMap((workspace) => workspace.sessions),
    ...projects.flatMap((project) => project.sessions)
  ].sort((left, right) => right.lastActivityAt - left.lastActivityAt)
  const hasV3ProjectionInput =
    input.projectGroups !== undefined ||
    input.folderWorkspaces !== undefined ||
    input.projects !== undefined ||
    input.projectHostSetups !== undefined ||
    hasExplicitActiveContext
  const model: DesktopHomeModel = {
    groups: roots,
    ungrouped,
    projects,
    workspaces,
    recentWorkspaces: workspaces,
    currentWorkspace,
    currentFiles: currentFilesForWorkspace(input.openFiles, currentWorkspace, workspaces),
    sessionSummaries,
    temporarySessions,
    projectCount: hasV3ProjectionInput ? projects.length : repos.length,
    workspaceCount: workspaces.length,
    sessionCount: sessionSummaries.length
  }
  preserveLegacyEmptyShape(model, input, repos)
  return model
}

export function findDesktopHomeWorkspace(
  model: DesktopHomeModel,
  workspaceId: string,
  executionHostId?: ExecutionHostId | null
): DesktopHomeWorkspace | null {
  const identityMatch = model.workspaces.find(
    (workspace) =>
      workspace.identityKey === workspaceId &&
      (!executionHostId || workspace.executionHostId === executionHostId)
  )
  if (identityMatch) {
    return identityMatch
  }
  const scopedMatches = model.workspaces.filter(
    (workspace) =>
      workspace.workspaceKey === workspaceId &&
      (!executionHostId || workspace.executionHostId === executionHostId)
  )
  if (scopedMatches.length > 1) {
    return null
  }
  if (scopedMatches.length === 1) {
    return scopedMatches[0]
  }
  const rawMatches = model.workspaces.filter(
    (workspace) =>
      workspace.id === workspaceId &&
      (!executionHostId || workspace.executionHostId === executionHostId)
  )
  // A bare id is not a safe locator once multiple execution hosts can publish
  // the same worktree/folder id. Callers must supply the host-qualified key (or
  // an explicit host) instead of silently activating the first matching row.
  return rawMatches.length === 1 ? rawMatches[0] : null
}

export { formatHomeRelativeTime }
