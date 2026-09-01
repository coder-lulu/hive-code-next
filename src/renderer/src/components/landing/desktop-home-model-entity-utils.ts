import { normalizeExecutionHostId } from '../../../../shared/execution-host'
import type { HomeRepo, HomeWorktree } from './desktop-home-model-utils'
import { repoHost } from './desktop-home-model-utils'

export function buildRepoIndex(repos: readonly HomeRepo[]): Map<string, HomeRepo[]> {
  const byId = new Map<string, HomeRepo[]>()
  for (const repo of repos) {
    const rows = byId.get(repo.id) ?? []
    rows.push(repo)
    byId.set(repo.id, rows)
  }
  return byId
}

export function findRepoForWorktree(
  repoById: Map<string, HomeRepo[]>,
  worktree: HomeWorktree,
  fallbackRepoId: string
): HomeRepo | undefined {
  const repoId = worktree.repoId || fallbackRepoId
  const candidates = repoById.get(repoId) ?? []
  if (candidates.length <= 1) {
    return candidates[0]
  }
  const worktreeHost = normalizeExecutionHostId(worktree.hostId)
  if (worktreeHost) {
    return candidates.find((repo) => repoHost(repo) === worktreeHost) ?? candidates[0]
  }
  // A hostless duplicate is legacy data. Prefer a path match before falling
  // back to the first catalog row, which is deterministic and safe to render.
  const pathMatch = candidates.find(
    (repo) => repo.path === worktree.path || worktree.path.startsWith(`${repo.path}/`)
  )
  return pathMatch ?? candidates[0]
}
