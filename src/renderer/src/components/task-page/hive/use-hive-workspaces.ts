import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useAllWorktrees } from '@/store/selectors'
import { folderWorkspaceKey } from '../../../../../shared/workspace-scope'

export function useHiveWorkspaces() {
  const folders = useAppStore((state) => state.folderWorkspaces)
  const worktrees = useAllWorktrees()
  return useMemo(
    () => [
      ...folders
        .filter(
          (folder) =>
            !folder.isArchived &&
            !folder.connectionId &&
            (!folder.executionHostId || folder.executionHostId === 'local')
        )
        .map((folder) => ({ id: folderWorkspaceKey(folder.id), name: folder.name })),
      ...worktrees
        .filter(
          (worktree) => !worktree.isArchived && (!worktree.hostId || worktree.hostId === 'local')
        )
        .map((worktree) => ({
          id: worktree.id,
          name: worktree.displayName || worktree.branch || worktree.path
        }))
    ],
    [folders, worktrees]
  )
}
