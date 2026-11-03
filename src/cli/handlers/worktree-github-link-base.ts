import { captureWorktreeGitHubLinkBase } from '../../shared/worktree/github-link-base'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

/** Resolve once so a path selector cannot switch targets between the read and write. */
export async function captureCliWorktreeGitHubLinkBase(client: RuntimeClient, selector: string) {
  const response = await client.call<{ worktree: unknown }>('worktree.show', { worktree: selector })
  const snapshot = response.result.worktree
  const githubLinkBase = captureWorktreeGitHubLinkBase(snapshot)
  const id =
    typeof snapshot === 'object' && snapshot !== null && Object.hasOwn(snapshot, 'id')
      ? (snapshot as { id?: unknown }).id
      : undefined
  if (
    !githubLinkBase ||
    typeof id !== 'string' ||
    !id.trim() ||
    (selector.startsWith('id:') && selector.slice(3) !== id)
  ) {
    throw new RuntimeClientError(
      'github_link_unavailable',
      'Cannot capture the selected workspace owner and stored PR state. Refresh the workspace and try again.'
    )
  }
  return { worktree: `id:${id}`, githubLinkBase }
}
