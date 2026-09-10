import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import type { VirtualizedScrollAnchor } from '@/hooks/useVirtualizedScrollAnchor'
import type { SessionListScope } from '../../../../shared/session-list-scope'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import WorktreeList from '../sidebar/WorktreeList'
import SidebarWorkspaceOptionsMenu from '../sidebar/SidebarWorkspaceOptionsMenu'
import SessionCreationMenu from './SessionCreationMenu'

export default function ProjectsNavigationPane({
  scope,
  onOpenWorkspace
}: {
  scope: SessionListScope
  onOpenWorkspace: (worktreeId: string, executionHostId: ExecutionHostId) => void
}): React.JSX.Element {
  useTranslation()
  const scrollOffsetRef = useRef(0)
  const scrollAnchorRef = useRef<VirtualizedScrollAnchor>(null)
  const openModal = useAppStore((s) => s.openModal)
  const selectedWorkspace =
    scope.kind === 'workspace'
      ? {
          worktreeId: scope.workspaceKey.replace(/^worktree:/, ''),
          executionHostId: scope.executionHostId
        }
      : null
  return (
    <section
      className="sessions-list-pane"
      data-testid="projects-navigation-pane"
      aria-label={translate('components.sessions.manageProjects', 'Manage projects')}
    >
      <div className="sessions-list-heading">
        <span className="min-w-0 flex-1 truncate font-medium">
          {translate('components.sessions.manageProjects', 'Manage projects')}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('components.sessions.addProject', 'Add project')}
          title={translate('components.sessions.addProject', 'Add project')}
          onClick={() => openModal('add-repo')}
        >
          <FolderPlus className="size-4" />
        </Button>
        <SidebarWorkspaceOptionsMenu fixedProjectHierarchy />
        <SessionCreationMenu scope={scope.kind === 'workspace' ? scope : { kind: 'all' }} />
      </div>
      <div
        className="sidebar-workspace-section min-h-0 flex-1 bg-worktree-sidebar"
        data-worktree-sidebar-container
      >
        <WorktreeList
          scrollOffsetRef={scrollOffsetRef}
          scrollAnchorRef={scrollAnchorRef}
          projectHierarchy
          selectedWorkspace={selectedWorkspace}
          onOpenWorkspace={onOpenWorkspace}
        />
      </div>
    </section>
  )
}
