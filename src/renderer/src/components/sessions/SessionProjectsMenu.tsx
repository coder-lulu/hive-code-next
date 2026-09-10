import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, FolderKanban } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { selectSessionCatalog } from './session-catalog'

export default function SessionProjectsMenu(): React.JSX.Element {
  useTranslation()
  const [expanded, setExpanded] = useState(true)
  const { projects } = useAppStore(selectSessionCatalog)
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
          <button
            className="session-project-row"
            type="button"
            key={project.key}
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
        ))}
      </div>
    </section>
  )
}
