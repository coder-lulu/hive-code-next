import { translate } from '@/i18n/i18n'
import {
  captureWorktreeGitHubLinkBase,
  type GitHubLinkBase
} from '../../../../../../shared/worktree/github-link-base'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import { getRuntimeEnvironmentRevision } from '../../../../runtime/runtime-environment-revision'
import { runtimeTargetForWorkspaceOwner } from '@/lib/resolve-owner'
import type { WorktreeSliceGet } from '../listing/worktree-slice-types'
import type { WorktreeMetaUpdateOptions } from '../../worktree-helpers'
import type { WorktreeMeta } from '../../../../../../shared/worktree/meta-types'

export function captureGitHubLinkMutation(
  get: WorktreeSliceGet,
  worktreeId: string,
  worktree: unknown,
  options: WorktreeMetaUpdateOptions | undefined
) {
  const base =
    options && 'githubLinkBase' in options
      ? options.githubLinkBase
      : captureWorktreeGitHubLinkBase(worktree)
  const current = captureGitHubLinkMutationGuard(get, worktreeId, options?.executionHostId, base)
  return {
    base,
    conflict(updates: Partial<WorktreeMeta>, worktree: unknown) {
      return (updates.linkedPR === null || 'suppressedGitHubPR' in updates) && !current(worktree)
        ? {
            ok: false as const,
            error: translate(
              'auto.store.slices.worktrees.metadata.github.link.mutation.snapshot.22963eef55',
              'Refresh this workspace before changing its GitHub pull request link.'
            )
          }
        : undefined
    }
  }
}

export function captureGitHubLinkMutationGuard(
  get: WorktreeSliceGet,
  worktreeId: string,
  hostId: ExecutionHostId | undefined,
  base: GitHubLinkBase | null | undefined
): (worktree: unknown) => boolean {
  const ownerRef = { workspaceId: worktreeId, ...(hostId ? { hostId } : {}) }
  const owner = runtimeTargetForWorkspaceOwner(get(), ownerRef)
  const revision =
    owner?.kind === 'environment' ? getRuntimeEnvironmentRevision(owner.environmentId) : undefined
  return (worktree) =>
    Boolean(
      base &&
      owner &&
      JSON.stringify(runtimeTargetForWorkspaceOwner(get(), ownerRef)) === JSON.stringify(owner) &&
      (owner.kind !== 'environment' ||
        getRuntimeEnvironmentRevision(owner.environmentId) === revision) &&
      JSON.stringify(captureWorktreeGitHubLinkBase(worktree)) === JSON.stringify(base)
    )
}
