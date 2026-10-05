/* eslint-disable max-lines -- Entity projection keeps host-aware legacy compatibility in one pass. */

import type { ExecutionHostId } from '../../../../shared/execution-host'
import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId
} from '../../../../shared/execution-host'
import { folderWorkspaceKey, worktreeWorkspaceKey } from '../../../../shared/workspace-scope'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type {
  BuildDesktopHomeModelInput,
  DesktopHomeProject,
  DesktopHomeWorkspace
} from './desktop-home-model-types'
import {
  branchLabel,
  hostLabel,
  normalizeHomeHostId,
  repoHost,
  stableSessions,
  statusFromValue,
  tabsForWorkspace,
  timestamp,
  type HomeFolderWorkspace,
  type HomeRepo,
  type HomeWorktree,
  workspaceIdentity
} from './desktop-home-model-utils'
import { addWorkspaceToProject } from './desktop-home-model-groups'
import { indexProjectHostSetups } from './desktop-home-model-setups'
import { createProject } from './desktop-home-model-projects'
import { buildRepoIndex, findRepoForWorktree } from './desktop-home-model-entity-utils'
export type DesktopHomeEntityProjection = {
  workspaces: DesktopHomeWorkspace[]
  projectsByIdentity: Map<string, DesktopHomeProject>
  folderSourcesByIdentity: Map<string, HomeFolderWorkspace>
}
function tabsFor(
  input: BuildDesktopHomeModelInput,
  workspace: Pick<DesktopHomeWorkspace, 'id' | 'workspaceKey' | 'identityKey' | 'executionHostId'>,
  allowLegacyRawKey: boolean
) {
  const seen = new Set<string>()
  const merged = [
    ...tabsForWorkspace(input.unifiedTabsByWorktree ?? {}, workspace, { allowLegacyRawKey }),
    ...tabsForWorkspace(input.tabsByWorktree, workspace, { allowLegacyRawKey })
  ]
  return merged.filter((tab) => {
    if (seen.has(tab.id)) {
      return false
    }
    seen.add(tab.id)
    return true
  })
}

function makeWorktreeWorkspace(
  input: BuildDesktopHomeModelInput,
  worktree: HomeWorktree,
  repo: HomeRepo,
  repoId: string,
  legacySessionCount: boolean,
  allowLegacyRawKey: boolean
): DesktopHomeWorkspace {
  const executionHostId = getWorktreeExecutionHostId(
    { hostId: normalizeExecutionHostId(worktree.hostId) ?? undefined },
    repo,
    getRepoExecutionHostId(repo)
  )
  const workspaceKey = worktreeWorkspaceKey(worktree.id)
  const identityKey = getWorktreeHostIdentity({ id: worktree.id, hostId: executionHostId })
  const placeholder = {
    id: worktree.id,
    workspaceKey,
    identityKey,
    executionHostId
  }
  const tabs = tabsFor(input, placeholder, allowLegacyRawKey)
  const lastActivityAt = timestamp(worktree.lastActivityAt ?? worktree.createdAt)
  const sessions = stableSessions(
    tabs,
    { type: 'worktree', worktreeId: worktree.id },
    lastActivityAt,
    { workspaceIdentityKey: identityKey, executionHostId }
  )
  const status = statusFromValue(worktree.workspaceStatus, sessions.length, executionHostId)
  return {
    id: worktree.id || repoId,
    workspaceKey,
    identityKey,
    kind: 'worktree',
    repoId: repo.id,
    worktreeId: worktree.id,
    repoName: repo.displayName,
    name: worktree.displayName,
    path: worktree.path,
    branch: branchLabel(worktree.branch, worktree.isMainWorktree),
    badgeColor: repo.badgeColor ?? null,
    hostLabel: hostLabel(executionHostId),
    hostDisplayName: input.hostLabelById?.get(executionHostId),
    executionHostId,
    sessionCount: legacySessionCount ? tabs.length : sessions.length,
    sessions,
    status: status.status,
    statusLabel: status.label,
    isUnread: worktree.isUnread === true,
    isPinned: worktree.isPinned === true,
    isMainWorktree: worktree.isMainWorktree,
    lastActivityAt
  }
}

function makeFolderWorkspace(
  input: BuildDesktopHomeModelInput,
  source: HomeFolderWorkspace,
  groupHostId: ExecutionHostId | null,
  allowLegacyRawKey: boolean
): DesktopHomeWorkspace {
  const executionHostId = normalizeHomeHostId(
    source.executionHostId,
    source.connectionId,
    groupHostId ?? LOCAL_EXECUTION_HOST_ID
  )
  const workspaceKey = folderWorkspaceKey(source.id)
  const identityKey = workspaceIdentity(executionHostId, workspaceKey)
  const placeholder = {
    id: source.id,
    workspaceKey,
    identityKey,
    executionHostId
  }
  const tabs = tabsFor(input, placeholder, allowLegacyRawKey)
  const lastActivityAt = timestamp(source.lastActivityAt ?? source.createdAt)
  const sessions = stableSessions(
    tabs,
    { type: 'folder', folderWorkspaceId: source.id },
    lastActivityAt,
    { workspaceIdentityKey: identityKey, executionHostId }
  )
  const status = statusFromValue(source.workspaceStatus, sessions.length, executionHostId)
  return {
    id: source.id,
    workspaceKey,
    identityKey,
    kind: 'folder',
    repoId: null,
    folderWorkspaceId: source.id,
    repoName: 'Folder workspace',
    name: source.name,
    path: source.folderPath,
    branch: 'folder',
    badgeColor: null,
    hostLabel: hostLabel(executionHostId),
    hostDisplayName: input.hostLabelById?.get(executionHostId),
    executionHostId,
    sessionCount: sessions.length,
    sessions,
    status: status.status,
    statusLabel: status.label,
    isUnread: source.isUnread === true,
    isPinned: source.isPinned === true,
    lastActivityAt
  }
}

export function buildHomeEntities(
  input: BuildDesktopHomeModelInput,
  repos: readonly HomeRepo[]
): DesktopHomeEntityProjection {
  const repoById = buildRepoIndex(repos)
  const projectSources = input.projects ?? []
  const setupIndex = indexProjectHostSetups(input.projectHostSetups)
  const projectsByIdentity = new Map<string, DesktopHomeProject>()
  // A repo/host pair can own many worktrees. Cache the resolved logical
  // project so those rows do not repeatedly scan the project and repository
  // catalogs or rebuild identical project metadata.
  const projectByRepoHost = new WeakMap<HomeRepo, Map<ExecutionHostId, DesktopHomeProject>>()
  const workspaceIdentitiesByProject = new Map<string, Set<string>>()
  const workspacesByIdentity = new Map<string, DesktopHomeWorkspace>()
  const folderSourcesByIdentity = new Map<string, HomeFolderWorkspace>()
  // A repository id is only unique within an execution host. Keep the host
  // in this marker so a populated local copy does not suppress an empty
  // project row for a same-id remote copy (or vice versa).
  const reposWithWorkspaces = new Set<string>()
  // Legacy repo snapshots often omit host metadata while the worktree row
  // still carries its runtime/SSH owner. Remember those owners so the
  // fallback project row can inherit the only unambiguous host instead of
  // manufacturing a duplicate local project beside the real one.
  const workspaceHostsByRepoId = new Map<string, Set<ExecutionHostId>>()
  // A legacy tabsByWorktree snapshot may be keyed by a bare id. Once that id
  // appears more than once in the projected catalog, using the bare bucket for
  // every row would leak sessions across hosts (or across workspace kinds).
  // Host-qualified/canonical keys remain available for those rows.
  const rawWorkspaceIdCounts = new Map<string, number>()
  const countRawWorkspaceId = (id: string): void => {
    rawWorkspaceIdCounts.set(id, (rawWorkspaceIdCounts.get(id) ?? 0) + 1)
  }
  for (const sourceWorktrees of Object.values(input.worktreesByRepo)) {
    for (const worktree of sourceWorktrees ?? []) {
      if (!worktree.isArchived) {
        countRawWorkspaceId(worktree.id)
      }
    }
  }
  for (const source of input.folderWorkspaces ?? []) {
    if (!source.isArchived) {
      countRawWorkspaceId(source.id)
    }
  }
  const allowLegacyRawKey = (id: string): boolean => (rawWorkspaceIdCounts.get(id) ?? 0) <= 1
  const legacySessionCount =
    input.projectGroups === undefined &&
    input.folderWorkspaces === undefined &&
    input.projects === undefined &&
    input.projectHostSetups === undefined &&
    input.unifiedTabsByWorktree === undefined

  const ensureProject = (repo: HomeRepo, host = repoHost(repo)): DesktopHomeProject => {
    const projectByHost =
      projectByRepoHost.get(repo) ?? new Map<ExecutionHostId, DesktopHomeProject>()
    const cached = projectByHost.get(host)
    if (cached) {
      return cached
    }
    const source = createProject(
      repo,
      host,
      projectSources,
      setupIndex.byRepoId,
      setupIndex.byProjectId,
      repos
    )
    source.hostDisplayName = input.hostLabelById?.get(host)
    const existing = projectsByIdentity.get(source.identityKey)
    if (existing) {
      // Multiple repos can point at one Project catalog row. Merge the source
      // metadata as each repo/worktree is encountered so the homepage exposes
      // one logical project with all of its repositories.
      existing.repoIds = [...new Set([...existing.repoIds, ...source.repoIds])]
      if (!existing.projectGroupId && source.projectGroupId) {
        existing.projectGroupId = source.projectGroupId
      }
      existing.lastActivityAt = Math.max(existing.lastActivityAt, source.lastActivityAt)
      existing.badgeColor ??= source.badgeColor
      if (existing.repoId === null) {
        existing.repoId = source.repoId
      }
      if (existing.hostSetups || source.hostSetups) {
        const setupById = new Map(
          [...(existing.hostSetups ?? []), ...(source.hostSetups ?? [])].map((setup) => [
            setup.id,
            setup
          ])
        )
        existing.hostSetups = [...setupById.values()]
      }
      projectByHost.set(host, existing)
      projectByRepoHost.set(repo, projectByHost)
      return existing
    }
    projectsByIdentity.set(source.identityKey, source)
    projectByHost.set(host, source)
    projectByRepoHost.set(repo, projectByHost)
    return source
  }

  const addWorkspace = (workspace: DesktopHomeWorkspace): void => {
    const existing = workspacesByIdentity.get(workspace.identityKey)
    if (existing) {
      // Keep the freshest catalog row if a fetch race published the same host
      // and id twice; the identity still renders exactly once.
      if (workspace.lastActivityAt > existing.lastActivityAt) {
        workspacesByIdentity.set(workspace.identityKey, workspace)
      }
      return
    }
    workspacesByIdentity.set(workspace.identityKey, workspace)
  }

  for (const [repoId, sourceWorktrees] of Object.entries(input.worktreesByRepo)) {
    for (const rawWorktree of sourceWorktrees ?? []) {
      if (rawWorktree.isArchived) {
        continue
      }
      const worktree = { ...rawWorktree, repoId: rawWorktree.repoId || repoId }
      const repo = findRepoForWorktree(repoById, worktree, repoId)
      if (!repo) {
        continue
      }
      const workspace = makeWorktreeWorkspace(
        input,
        worktree,
        repo,
        repoId,
        legacySessionCount,
        allowLegacyRawKey(worktree.id)
      )
      addWorkspace(workspace)
      reposWithWorkspaces.add(`${workspace.executionHostId}|${repo.id}`)
      const workspaceHosts = workspaceHostsByRepoId.get(repo.id) ?? new Set<ExecutionHostId>()
      workspaceHosts.add(workspace.executionHostId)
      workspaceHostsByRepoId.set(repo.id, workspaceHosts)
      const project = ensureProject(repo, workspace.executionHostId)
      const projectWorkspaceIdentities =
        workspaceIdentitiesByProject.get(project.identityKey) ?? new Set<string>()
      addWorkspaceToProject(project, workspace, projectWorkspaceIdentities)
      workspaceIdentitiesByProject.set(project.identityKey, projectWorkspaceIdentities)
    }
  }

  for (const source of input.folderWorkspaces ?? []) {
    if (source.isArchived) {
      continue
    }
    const explicitHost = normalizeExecutionHostId(source.executionHostId)
    const groupCandidates = (input.projectGroups ?? []).filter(
      (group) => group.id === source.projectGroupId
    )
    const groupHostId = explicitHost
      ? explicitHost
      : groupCandidates.length === 1
        ? normalizeHomeHostId(groupCandidates[0].executionHostId, groupCandidates[0].connectionId)
        : null
    const workspace = makeFolderWorkspace(input, source, groupHostId, allowLegacyRawKey(source.id))
    addWorkspace(workspace)
    folderSourcesByIdentity.set(workspace.identityKey, source)
  }

  // A repository with no visible workspace still needs a project row so the
  // landing page can offer its first-workspace action. When workspaces exist,
  // derive the row from their actual host instead of also creating an empty
  // local row for a runtime/SSH snapshot.
  for (const repo of repos) {
    const hasExplicitHost = Boolean(
      normalizeExecutionHostId(repo.executionHostId) || repo.connectionId?.trim()
    )
    const workspaceHosts = workspaceHostsByRepoId.get(repo.id)
    if (!hasExplicitHost && workspaceHosts && workspaceHosts.size > 0) {
      // Without explicit metadata, a legacy repo is represented by the host
      // stamped on its visible worktree(s). Those rows already created the
      // corresponding project(s), so do not add a guessed local duplicate.
      continue
    }
    const repoHostKey = `${repoHost(repo)}|${repo.id}`
    if (!reposWithWorkspaces.has(repoHostKey)) {
      ensureProject(repo)
    }
  }

  const workspaces = [...workspacesByIdentity.values()]
  for (const project of projectsByIdentity.values()) {
    // `addWorkspaceToProject` may have received a stale duplicate before the
    // final map was chosen; reconcile against the canonical workspace map.
    const canonicalWorkspaces: DesktopHomeWorkspace[] = []
    const canonicalWorkspaceIdentities = new Set<string>()
    for (const source of project.workspaces) {
      const workspace = workspacesByIdentity.get(source.identityKey) ?? source
      if (canonicalWorkspaceIdentities.has(workspace.identityKey)) {
        continue
      }
      canonicalWorkspaceIdentities.add(workspace.identityKey)
      canonicalWorkspaces.push(workspace)
    }
    project.workspaces = canonicalWorkspaces
    project.workspaceCount = project.workspaces.length
  }
  return { workspaces, projectsByIdentity, folderSourcesByIdentity }
}
