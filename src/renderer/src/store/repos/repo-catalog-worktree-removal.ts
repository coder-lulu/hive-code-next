import type { AppState } from '../types'
import type { Repo } from '../../../../shared/repo-types'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { worktreeMatchesHost } from '../slices/worktrees/listing/worktree-host-ownership'
import { buildWorktreePurgeState } from '../slices/worktrees/teardown/worktree-purge-state'
import {
  forgetPersistedWorktreeMetaForRemovals,
  rememberAuthoritativelyRemovedWorktrees
} from '../slices/worktrees/listing/authoritative-worktree-removal-memory'

export type RepoCatalogWorktreeRemoval = {
  patch: Partial<AppState>
  removedByRepo: Map<string, string[]>
}

// Only call after accepting a complete, current catalog from this host.
export function reconcileRepoCatalogWorktrees(
  state: AppState,
  nextRepos: readonly Repo[],
  hostId: ExecutionHostId
): RepoCatalogWorktreeRemoval {
  const present = new Set(
    nextRepos.filter((repo) => getRepoExecutionHostId(repo) === hostId).map((repo) => repo.id)
  )
  const worktreesByRepo = { ...state.worktreesByRepo }
  const detectedWorktreesByRepo = { ...state.detectedWorktreesByRepo }
  const removedByRepo = new Map<string, string[]>()
  const purgeIds: string[] = []
  const removedIds = new Set<string>()
  for (const repoId of new Set([
    ...Object.keys(worktreesByRepo),
    ...Object.keys(detectedWorktreesByRepo)
  ])) {
    if (present.has(repoId)) {
      continue
    }
    const owners = state.repos.filter((repo) => repo.id === repoId)
    if (owners.some((repo) => repo.kind === 'folder' && getRepoExecutionHostId(repo) === hostId)) {
      continue
    }
    const removed = new Set<string>()
    const matches = (row: {
      id: string
      hostId?: ExecutionHostId
      runtimeOwnerEnvironmentId?: string
    }): boolean => {
      if (parseWorkspaceKey(row.id)?.type === 'folder') {
        return false
      }
      const match = worktreeMatchesHost(row, hostId, {
        unhostedWorktreesMatchHost:
          owners.length === 1 && getRepoExecutionHostId(owners[0]) === hostId
      })
      if (match) {
        removed.add(row.id)
      }
      return match
    }
    const worktrees = worktreesByRepo[repoId]
    if (worktrees) {
      const kept = worktrees.filter((row) => !matches(row))
      if (kept.length !== worktrees.length) {
        if (kept.length) {
          worktreesByRepo[repoId] = kept
        } else {
          delete worktreesByRepo[repoId]
        }
      }
    }
    const detected = detectedWorktreesByRepo[repoId]
    if (detected) {
      const kept = detected.worktrees.filter((row) => !matches(row))
      if (kept.length !== detected.worktrees.length) {
        if (kept.length) {
          detectedWorktreesByRepo[repoId] = { ...detected, worktrees: kept }
        } else {
          delete detectedWorktreesByRepo[repoId]
        }
      }
    }
    if (!removed.size) {
      continue
    }
    removedByRepo.set(repoId, [...removed])
    const survivingIds = new Set(
      [
        ...(worktreesByRepo[repoId] ?? []),
        ...(detectedWorktreesByRepo[repoId]?.worktrees ?? [])
      ].map((row) => row.id)
    )
    // Raw-id tab maps cannot distinguish host twins; keep shared session state for surviving owners.
    const hasSiblingRepo = nextRepos.some((repo) => repo.id === repoId)
    for (const id of removed) {
      removedIds.add(id)
      const activeOnOtherHost =
        state.activeWorktreeId === id &&
        state.activeWorkspaceExecutionHostId !== null &&
        state.activeWorkspaceExecutionHostId !== hostId
      if (!hasSiblingRepo && !survivingIds.has(id) && !activeOnOtherHost) {
        purgeIds.push(id)
      }
    }
  }
  if (!removedByRepo.size) {
    return { patch: {}, removedByRepo }
  }
  const clearActive =
    state.activeWorktreeId !== null &&
    removedIds.has(state.activeWorktreeId) &&
    state.activeWorkspaceExecutionHostId === hostId
  return {
    removedByRepo,
    patch: {
      ...(purgeIds.length ? buildWorktreePurgeState(state, purgeIds) : {}),
      worktreesByRepo,
      detectedWorktreesByRepo,
      sortEpoch: state.sortEpoch + 1,
      folderWorkspacePathStatuses: {},
      ...(clearActive
        ? { activeWorktreeId: null, activeWorkspaceKey: null, activeWorkspaceExecutionHostId: null }
        : {})
    }
  }
}

export function retireRepoCatalogWorktreeMetadata(
  hostId: ExecutionHostId,
  removedByRepo: ReadonlyMap<string, readonly string[]>
): void {
  for (const [repoId, ids] of removedByRepo) {
    rememberAuthoritativelyRemovedWorktrees(hostId, ids)
    forgetPersistedWorktreeMetaForRemovals(repoId, hostId, ids)
  }
}
