import type React from 'react'
import { useMemo } from 'react'
import { FolderGit2, FolderTree, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { translate } from '@/i18n/i18n'
import type {
  DesktopHomeModel,
  DesktopHomeProject,
  DesktopHomeProjectGroup,
  DesktopHomeSession,
  DesktopHomeWorkspace,
  HomeRelativeTimeLabels
} from './desktop-home-model'
import DesktopHomeProjectTree from './DesktopHomeProjectTree'

type DesktopHomeProjectListProps = {
  model: DesktopHomeModel
  activeWorkspaceIdentity?: string | null
  timeLabels: HomeRelativeTimeLabels
  onToggleGroup: (collapseKey: string) => void
  onCreateWorkspace: (project: DesktopHomeProject | null, group?: DesktopHomeProjectGroup) => void
  onManageProjects: () => void
  pendingSession: DesktopHomeSession | null
  onCancelSessionSave: () => void
  onActivateSession: (session: DesktopHomeSession) => void
  onSaveTemporarySession: (
    session: DesktopHomeSession,
    target?: DesktopHomeProject | DesktopHomeProjectGroup
  ) => void
}

export function DesktopHomeProjectList({
  model,
  activeWorkspaceIdentity = null,
  timeLabels,
  onToggleGroup,
  onCreateWorkspace,
  onManageProjects,
  pendingSession,
  onCancelSessionSave,
  onActivateSession,
  onSaveTemporarySession
}: DesktopHomeProjectListProps): React.JSX.Element {
  useTranslation()
  const visibleRoots = useMemo(() => {
    const roots = [...model.groups]
    if (model.ungrouped.projects.length > 0 || model.ungrouped.folderWorkspaces.length > 0) {
      roots.push(model.ungrouped)
    }
    return roots
  }, [model.groups, model.ungrouped])
  const activate = (workspace: DesktopHomeWorkspace): boolean => {
    return Boolean(
      activateAndRevealWorkspace(
        workspace.kind === 'folder' ? workspace.workspaceKey : workspace.id,
        { executionHostId: workspace.executionHostId }
      )
    )
  }
  const hasRows = visibleRoots.length > 0
  return (
    <div className="desktop-home-project-list" data-testid="desktop-home-project-list">
      <div className="desktop-home-project-list-toolbar">
        <div className="desktop-home-project-list-heading">
          <FolderTree aria-hidden />
          <span>
            {pendingSession
              ? translate('components.desktopHome.chooseSessionProject', 'Choose a project')
              : translate('components.desktopHome.spaces', 'Spaces')}
          </span>
          <span className="desktop-home-project-list-total">{model.workspaceCount}</span>
        </div>
        <button
          type="button"
          className="desktop-home-project-list-manage"
          onClick={pendingSession ? onCancelSessionSave : onManageProjects}
        >
          {pendingSession
            ? translate('components.desktopHome.cancelSessionSave', 'Cancel')
            : translate('components.desktopHome.manageProjects', 'Manage projects')}
        </button>
      </div>
      {hasRows ? (
        <DesktopHomeProjectTree
          groups={visibleRoots}
          activeWorkspaceIdentity={activeWorkspaceIdentity}
          timeLabels={timeLabels}
          onToggleGroup={onToggleGroup}
          onCreateWorkspace={onCreateWorkspace}
          onActivate={activate}
          temporarySessions={model.temporarySessions}
          pendingSession={pendingSession}
          onActivateSession={onActivateSession}
          onSaveTemporarySession={onSaveTemporarySession}
        />
      ) : (
        <div className="desktop-home-empty desktop-home-project-list-empty">
          <FolderGit2 aria-hidden />
          <p>{translate('components.desktopHome.noProjects', 'No projects yet')}</p>
          <span>
            {translate(
              'components.desktopHome.noProjectsDescription',
              'Add a repository or folder to get started.'
            )}
          </span>
          <button
            type="button"
            className="desktop-home-secondary-button"
            onClick={() => onCreateWorkspace(null)}
          >
            <Plus aria-hidden />
            {translate('components.desktopHome.addProject', 'Add project')}
          </button>
        </div>
      )}
    </div>
  )
}

export default DesktopHomeProjectList
