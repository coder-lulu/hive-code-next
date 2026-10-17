import { translate } from '@/i18n/i18n'
import {
  getWorktreeGitIdentityDisplay as getIdentity,
  type WorktreeGitIdentityDisplay
} from '../../../shared/worktree/git-identity-display'
export type { WorktreeGitIdentityDisplay } from '../../../shared/worktree/git-identity-display'

export function getDetachedHeadTooltip(shortHead: string): string {
  return translate(
    'components.detachedHead.tooltip',
    'Detached HEAD at {{head}}. You are viewing a commit, not a branch.',
    { head: shortHead }
  )
}

export function getWorktreeGitIdentityDisplay(
  input: Parameters<typeof getIdentity>[0]
): WorktreeGitIdentityDisplay | null {
  const identity = getIdentity(input)
  if (!identity || identity.kind !== 'detached') {
    return identity
  }
  const head = identity.shortHead
  return {
    ...identity,
    sidebarLabel: translate('components.detachedHead.sidebar', 'Detached HEAD @ {{head}}', {
      head
    }),
    sourceControlLabel: translate(
      'components.detachedHead.sourceControl',
      'Detached HEAD · {{head}}',
      { head }
    ),
    tooltip: getDetachedHeadTooltip(head)
  }
}
