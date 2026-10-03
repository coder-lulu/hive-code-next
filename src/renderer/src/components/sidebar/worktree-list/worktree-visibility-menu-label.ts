import type { WorktreeVisibilityDefaults } from '../../../../../shared/global-settings-types'
import type { Repo } from '../../../../../shared/repo-types'
import {
  effectiveExternalWorktreeVisibility,
  isLegacyRepoForExternalWorktreeVisibility
} from '../../../../../shared/worktree/ownership'
import { applyProductBranding } from '@/product-brand'

export function getWorktreeVisibilityMenuLabel(
  repo: Repo,
  visibilityDefaults?: WorktreeVisibilityDefaults
): string {
  const visibility = effectiveExternalWorktreeVisibility(
    repo,
    isLegacyRepoForExternalWorktreeVisibility(repo),
    visibilityDefaults
  )
  return visibility === 'show'
    ? applyProductBranding('Hide non-Orca worktrees')
    : 'Show hidden worktrees'
}
