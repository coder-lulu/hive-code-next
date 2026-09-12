import { memo, useId, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import type { VirtualizedScrollAnchor } from '@/hooks/useVirtualizedScrollAnchor'
import type { SessionListScope } from '../../../../shared/session-list-scope'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { useNavigationPaneResize } from './useNavigationPaneResize'
import NavigationPaneToggle from './NavigationPaneToggle'
import WorktreeList from '../sidebar/WorktreeList'
import SidebarWorkspaceOptionsMenu from '../sidebar/SidebarWorkspaceOptionsMenu'
import { WorkspaceBoardButton } from '../sidebar/WorkspaceBoardButton'
import type { WorkspaceBoardPanelState } from '../sidebar/useWorkspaceBoardPanel'
import SessionCreationMenu from './SessionCreationMenu'

export default memo(function ProjectsNavigationPane({
  scope,
  workspaceBoardPanel,
  onOpenWorkspace,
  useActiveWorkspace = false
}: {
  workspaceBoardPanel?: WorkspaceBoardPanelState
  scope: SessionListScope
  useActiveWorkspace?: boolean
  onOpenWorkspace?: (worktreeId: string, executionHostId: ExecutionHostId) => void
}): React.JSX.Element {
  useTranslation()
  const contentId = useId()
  const { containerRef, resizeHandle, collapsed, toggleCollapsed } = useNavigationPaneResize(
    'hive-projects-pane-width',
    translate('components.sessions.resizeProjects', 'Resize projects pane')
  )
  const scrollOffsetRef = useRef(0)
  const scrollAnchorRef = useRef<VirtualizedScrollAnchor>(null)
  const openModal = useAppStore((s) => s.openModal)
  const selectedWorkspace = useMemo(
    () =>
      scope.kind === 'workspace'
        ? {
            worktreeId: scope.workspaceKey.replace(/^worktree:/, ''),
            executionHostId: scope.executionHostId
          }
        : null,
    [scope]
  )
  return (
    <section
      ref={containerRef}
      className="sessions-list-pane projects-navigation-pane"
      data-testid="projects-navigation-pane"
      data-collapsed={collapsed}
      aria-label={translate('components.sessions.projectNavigation', 'Projects')}
    >
      {resizeHandle}
      <div className="sessions-list-heading">
        <div className="navigation-pane-heading-content" hidden={collapsed}>
          <span className="min-w-0 flex-1 truncate font-medium">
            {translate('components.sessions.projectNavigation', 'Projects')}
          </span>
          {workspaceBoardPanel && (
            <WorkspaceBoardButton workspaceBoardPanel={workspaceBoardPanel} />
          )}
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
          <SessionCreationMenu
            returnToSessions={!useActiveWorkspace}
            scope={scope.kind === 'workspace' ? scope : { kind: 'all' }}
          />
        </div>
        <NavigationPaneToggle
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          controlsId={contentId}
          kind="projects"
        />
      </div>
      <div id={contentId} className="navigation-pane-content" hidden={collapsed}>
        <div
          className="sidebar-workspace-section min-h-0 flex-1 bg-worktree-sidebar"
          data-worktree-sidebar-container
        >
          <WorktreeList
            scrollOffsetRef={scrollOffsetRef}
            scrollAnchorRef={scrollAnchorRef}
            projectHierarchy
            selectedWorkspace={useActiveWorkspace ? undefined : selectedWorkspace}
            onOpenWorkspace={onOpenWorkspace}
          />
        </div>
      </div>
    </section>
  )
})
