import { MessageCircle, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useSessionCollection } from './use-session-collection'
import { useOpenSession } from './use-open-session'
import SessionStatus from './SessionStatus'
import {
  getSidebarActiveSessionTarget,
  isSidebarSessionActive
} from '../sidebar/sidebar-session-active-target'

export default function SessionNavigationSection(): React.JSX.Element {
  useTranslation()
  const { items } = useSessionCollection()
  const openSessionsPage = useAppStore((state) => state.openSessionsPage)
  const openNewTaskHome = useAppStore((state) => state.openNewTaskHome)
  const selectedKey = useAppStore((state) =>
    state.activeView === 'sessions' ? state.sessionsView.selectedSessionKey : null
  )
  const { openingKey, openSession } = useOpenSession()
  const activeTarget = useAppStore(useShallow(getSidebarActiveSessionTarget))
  const activeHost = useAppStore((state) => state.activeWorkspaceExecutionHostId)
  return (
    <section
      className="sidebar-session-section session-navigation"
      data-testid="session-navigation"
      aria-label={translate('components.sessions.recent', 'Recent sessions')}
    >
      <header className="sidebar-hierarchy-heading">
        <div className="sidebar-hierarchy-heading-label">
          <MessageCircle aria-hidden />
          <span>{translate('components.sessions.recent', 'Recent sessions')}</span>
          <span className="sidebar-hierarchy-count">{items.length}</span>
        </div>
        <div className="sidebar-hierarchy-heading-actions">
          <button
            type="button"
            className="sidebar-hierarchy-link"
            onClick={() => openSessionsPage({ kind: 'all' })}
          >
            {translate('components.sidebar.sessions.viewAll', 'View all')}
          </button>
          <button
            type="button"
            className="sidebar-hierarchy-icon-button"
            onClick={() => openNewTaskHome()}
            aria-label={translate('components.sessions.new', 'New session')}
          >
            <Plus aria-hidden />
          </button>
        </div>
      </header>
      {items.length ? (
        <div className="session-quick-list">
          {items.slice(0, 4).map((item) => (
            <button
              type="button"
              key={item.key}
              className="session-quick-row"
              aria-current={
                selectedKey === item.key ||
                (isSidebarSessionActive(item, activeTarget) &&
                  (!activeHost || activeHost === item.executionHostId))
                  ? 'true'
                  : undefined
              }
              disabled={openingKey !== null}
              onClick={() => void openSession(item)}
              title={[item.title, item.projectLabel, item.workspaceLabel, item.hostLabel]
                .filter(Boolean)
                .join(' · ')}
            >
              <span className="session-quick-title">{item.title}</span>
              <span className="session-quick-meta">
                <SessionStatus status={item.status} />
                <span className="truncate">
                  {[item.hostLabel, item.workspaceLabel].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="session-quick-empty">
          {translate('components.sessions.noRecent', 'Your current sessions will appear here.')}
        </p>
      )}
    </section>
  )
}
