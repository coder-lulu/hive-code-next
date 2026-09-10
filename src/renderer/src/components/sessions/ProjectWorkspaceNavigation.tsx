import { useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  getActiveSidebarWorkspaceId,
  worktreeWorkspaceKey
} from '../../../../shared/workspace-scope'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import type { SessionListScope } from '../../../../shared/session-list-scope'
import type { WorkspaceBoardPanelState } from '../sidebar/useWorkspaceBoardPanel'
import ProjectsNavigationPane from './ProjectsNavigationPane'

/** Uses the same active owner and activation path as the retained workbench. */
export default function ProjectWorkspaceNavigation({
  workspaceBoardPanel
}: {
  workspaceBoardPanel: WorkspaceBoardPanelState
}): React.JSX.Element {
  const worktreeId = useAppStore((s) =>
    getActiveSidebarWorkspaceId(s.activeWorkspaceKey, s.activeWorktreeId)
  )
  const hostId = useAppStore(
    (s) => s.activeWorkspaceExecutionHostId ?? getResolvedExecutionHostIdForWorktree(s, worktreeId)
  )
  const scope = useMemo<SessionListScope>(
    () =>
      worktreeId && hostId
        ? {
            kind: 'workspace',
            workspaceKey: worktreeId.startsWith('folder:')
              ? worktreeId
              : worktreeWorkspaceKey(worktreeId),
            executionHostId: hostId
          }
        : { kind: 'all' },
    [worktreeId, hostId]
  )
  return (
    <ProjectsNavigationPane
      scope={scope}
      workspaceBoardPanel={workspaceBoardPanel}
      useActiveWorkspace
    />
  )
}
