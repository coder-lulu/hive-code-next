import type { Repo } from '../../../../../shared/repo-types'
import { applyProductBranding } from '@/product-brand'
import {
  effectiveExternalWorktreeVisibility,
  isLegacyRepoForExternalWorktreeVisibility
} from '../../../../../shared/worktree/ownership'

export function getWorktreeVisibilityMenuLabel(repo: Repo): string {
  const visibility = effectiveExternalWorktreeVisibility(
    repo,
    isLegacyRepoForExternalWorktreeVisibility(repo)
  )
  return visibility === 'show'
    ? applyProductBranding('Hide non-Orca worktrees')
    : 'Show hidden worktrees'
}
