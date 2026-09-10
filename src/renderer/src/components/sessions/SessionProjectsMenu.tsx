import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, FolderKanban } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import SessionCreationMenu from './SessionCreationMenu'
import { selectSessionCatalog } from './session-catalog'

export default function SessionProjectsMenu(): React.JSX.Element {
  useTranslation()
  const [expanded, setExpanded] = useState(true)
  const { projects, entities } = useAppStore(selectSessionCatalog)
  const scope = useAppStore((state) => state.sessionsView.scope)
  const activeView = useAppStore((state) => state.activeView)
  const openSessionsPage = useAppStore((state) => state.openSessionsPage)
  return (
    <section
      className="session-project-navigation"
      aria-label={translate('components.sessions.projects', 'Project sessions')}
    >
      <button
        className="session-project-heading"
        type="button"
        aria-expanded={expanded}
        aria-controls="session-project-list"
        onClick={() => setExpanded(!expanded)}
      >
        <FolderKanban className="size-4 shrink-0" aria-hidden />
        <span>{translate('components.sessions.projects', 'Project sessions')}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </button>
      <div id="session-project-list" hidden={!expanded}>
        {projects.map((project) => (
          <div key={project.key} className="session-project-navigation-row">
            <button
              className="session-project-row"
              type="button"
              aria-current={
                activeView === 'sessions' &&
                scope.kind === 'project' &&
                scope.projectKey === project.key
                  ? 'page'
                  : undefined
              }
              title={[project.label, project.hostLabel].filter(Boolean).join(' · ')}
              onClick={() => openSessionsPage({ kind: 'project', projectKey: project.key })}
            >
              <FolderKanban className="size-4 shrink-0" aria-hidden />
              <span>{project.label}</span>
            </button>
            <SessionCreationMenu scope={{ kind: 'project', projectKey: project.key }} />
          </div>
        ))}
        {entities.workspaces
          .filter((workspace) => workspace.kind === 'folder')
          .map((workspace) => (
            <button
              key={workspace.identityKey}
              type="button"
              className="session-project-row"
              title={`${workspace.name} · ${workspace.path}`}
              aria-current={
                activeView === 'sessions' &&
                scope.kind === 'workspace' &&
                scope.workspaceKey === workspace.workspaceKey &&
                scope.executionHostId === workspace.executionHostId
                  ? 'page'
                  : undefined
              }
              onClick={() =>
                openSessionsPage({
                  kind: 'workspace',
                  workspaceKey: workspace.workspaceKey,
                  executionHostId: workspace.executionHostId
                })
              }
            >
              <FolderKanban className="size-4 shrink-0" aria-hidden />
              <span>{workspace.name}</span>
            </button>
          ))}
      </div>
    </section>
  )
}
