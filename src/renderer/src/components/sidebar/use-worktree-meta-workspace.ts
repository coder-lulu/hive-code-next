import { useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  findIndexedWorktreeOwner,
  findIndexedWorktreeOwnerForHost
} from '@/lib/worktree-runtime-owner-index'
import { worktreeMatchesHost } from '@/store/slices/worktrees/listing/worktree-host-ownership'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { getFolderWorkspaceHostId } from '@/store/folder-workspaces/folder-workspace-catalog'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'

/** Resolves the edited workspace within its execution host, including folders. */
export function useWorktreeMetaWorkspace(args: {
  worktreeId: string
  /** The repo bucket the opening row belongs to, when it knows. */
  ownerRepoId: string | null
  executionHostId?: ExecutionHostId
}): {
  worktree: Worktree | undefined
  isFolderWorkspace: boolean
} {
  const { worktreeId, ownerRepoId, executionHostId } = args
  const requestedHost = parseExecutionHostId(executionHostId)?.id
  const workspaceScope = useMemo(() => parseWorkspaceKey(worktreeId), [worktreeId])
  const indexedWorktree = useAppStore((s) => {
    if (executionHostId && !requestedHost) {
      return undefined
    }
    // Why: the same workspace ID can exist under two hosts, which the owner index
    // reports as ambiguous rather than guessing. The row that opened the dialog
    // knows which one it is; the index stays the fallback for callers that cannot.
    const scoped = ownerRepoId
      ? s.worktreesByRepo[ownerRepoId]?.find(
          (item) =>
            item.id === worktreeId &&
            (!requestedHost ||
              worktreeMatchesHost(item, requestedHost, {
                unhostedWorktreesMatchHost: requestedHost === 'local'
              }))
        )
      : undefined
    if (scoped) {
      return scoped
    }
    // A known host must never fall back to a same-id row owned by another host.
    const owner = requestedHost
      ? findIndexedWorktreeOwnerForHost(s.worktreesByRepo, worktreeId, requestedHost)
      : findIndexedWorktreeOwner(s.worktreesByRepo, worktreeId)
    return owner && (!ownerRepoId || owner.repoId === ownerRepoId)
      ? s.worktreesByRepo[owner.repoId]?.find((item) => item === owner)
      : undefined
  })
  // Why: folder workspaces are absent from worktreesByRepo, so the lookup above
  // returns undefined and the row renders blank for them. The selector returns
  // the stored record — a stable reference — and the projection happens outside
  // it, because a selector that built the object would return a fresh identity
  // on every store write and re-render the dialog continuously.
  const folderWorkspace = useAppStore((s) => {
    if (workspaceScope?.type !== 'folder' || (executionHostId && !requestedHost)) {
      return null
    }
    const candidates = s.folderWorkspaces.filter(
      (item) =>
        item.id === workspaceScope.folderWorkspaceId &&
        (!executionHostId || getFolderWorkspaceHostId(item, s.projectGroups) === requestedHost)
    )
    return candidates.length === 1 ? candidates[0] : null
  })
  const worktree = useMemo(
    () => (folderWorkspace ? folderWorkspaceToWorktree(folderWorkspace) : indexedWorktree),
    [folderWorkspace, indexedWorktree]
  )
  return {
    worktree,
    isFolderWorkspace: workspaceScope?.type === 'folder'
  }
}
