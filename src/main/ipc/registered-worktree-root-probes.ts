import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { withTimeout } from '../../shared/promise-timeout-fallback'
import type { Repo } from '../../shared/repo-types'
import { getErrorCode } from '../git/worktree-operation-options'
import { resolveLocalProjectRuntimesForRepos } from '../local-project-runtime-resolution'
import type { Store } from '../persistence'
import { getWorktreeMirrorDistroForRuntime } from '../project-runtime-git-options'
import { listRepoWorktreeGraph } from '../repo-worktrees'

const CREATED_WORKTREE_ROOT_PROBE_TIMEOUT_MS = 1_000
const AUTHORIZED_ROOTS_REBUILD_CONCURRENCY = 8

/** `wslDistro` names the Git that listed the roots; undefined is host Git. */
type ListedRoots = { roots: Set<string>; listingFailed: boolean; wslDistro: string | undefined }

/**
 * Why the project runtime's distro: the catalog and removal list through it, and WSL Git records a
 * `C:\` worktree as `/mnt/c/...`, which host Git reading that metadata names as another path. A
 * runtime awaiting repair has no distro, so it keeps the host Git this listing always used.
 */
export async function listWorktreeRootsWithConcurrency(
  store: Store,
  repos: readonly Repo[]
): Promise<ListedRoots[]> {
  const runtimes = resolveLocalProjectRuntimesForRepos(store, repos)
  const results: ListedRoots[] = []
  let nextIndex = 0
  await Promise.all(
    Array.from(
      { length: Math.min(AUTHORIZED_ROOTS_REBUILD_CONCURRENCY, repos.length) },
      async () => {
        while (nextIndex < repos.length) {
          const index = nextIndex++
          const repo = repos[index]
          const wslDistro = getWorktreeMirrorDistroForRuntime(runtimes.get(repo.id))
          const registeredPath = resolve(repo.path)
          const roots = new Set([registeredPath])
          let listingFailed = false
          try {
            const graph = await listRepoWorktreeGraph(repo, wslDistro ? { wslDistro } : {})
            // Git searches ancestors when a nested repository loses its metadata. Only a
            // registered graph root may authorize the other worktrees that Git reports.
            if (await graphContainsRegisteredRoot(registeredPath, graph)) {
              for (const worktree of graph) {
                roots.add(resolve(worktree.path))
              }
            } else {
              listingFailed = true
            }
          } catch (error) {
            console.warn(
              `[filesystem-auth] skipping repo ${repo.path} during cache rebuild:`,
              error
            )
            listingFailed = true
          }
          results[index] = { roots, listingFailed, wslDistro }
        }
      }
    )
  )
  return results
}

/** An unavailable mount is not evidence that a recovered worktree disappeared. */
export async function pruneCreatedWorktreeRoots(
  recoveredRoots: ReadonlySet<string>,
  listed: ListedRoots
): Promise<Set<string>> {
  const recovered = new Set(recoveredRoots)
  if (!listed.listingFailed) {
    await Promise.all(
      [...recovered].map(async (root) => {
        if (listed.roots.has(root) || (await isRootGoneFromDisk(root))) {
          recovered.delete(root)
        }
      })
    )
  }
  return recovered
}

async function isRootGoneFromDisk(targetPath: string): Promise<boolean> {
  const probe = stat(targetPath).then(
    () => false,
    (error: unknown) => getErrorCode(error) === 'ENOENT'
  )
  return withTimeout(probe, CREATED_WORKTREE_ROOT_PROBE_TIMEOUT_MS, false)
}

async function graphContainsRegisteredRoot(
  registeredPath: string,
  graph: readonly { path: string }[]
): Promise<boolean> {
  if (graph.length === 0) {
    return false
  }
  const registered = resolve(registeredPath)
  if (graph.some((worktree) => resolve(worktree.path) === registered)) {
    return true
  }
  // Prove aliases through the filesystem, never Unicode or case folding alone.
  const canonicalRegistered = await realpath(registered)
  for (const worktree of graph) {
    try {
      if ((await realpath(resolve(worktree.path))) === canonicalRegistered) {
        return true
      }
    } catch {
      // An unavailable graph entry cannot prove the registered root's identity.
    }
  }
  return false
}
