import type React from 'react'
import { ChevronRight, FolderInput, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useNow } from '@/hooks/use-now'
import type { DesktopHomeSession, HomeRelativeTimeLabels } from './desktop-home-model'
import { formatHomeRelativeTime } from './desktop-home-model-utils'
import { writeDesktopHomeSessionDragData } from './desktop-home-session-drag'

function sessionStatusClass(status: DesktopHomeSession['status']): string {
  switch (status) {
    case 'running':
      return 'is-running'
    case 'waiting':
      return 'is-waiting'
    case 'error':
      return 'is-error'
    case 'completed':
      return 'is-completed'
  }
}

function sessionStatusLabel(status: DesktopHomeSession['status']): string {
  switch (status) {
    case 'running':
      return translate('components.desktopHome.sessionStatus.running', 'Running')
    case 'waiting':
      return translate('components.desktopHome.sessionStatus.waiting', 'Waiting')
    case 'error':
      return translate('components.desktopHome.sessionStatus.error', 'Needs attention')
    case 'completed':
      return translate('components.desktopHome.sessionStatus.completed', 'Completed')
  }
}

function SessionSummaryRow({
  session,
  timeLabels,
  onActivate,
  onSaveToProject
}: {
  session: DesktopHomeSession
  timeLabels: HomeRelativeTimeLabels
  onActivate: (session: DesktopHomeSession) => void
  onSaveToProject: (session: DesktopHomeSession) => void
}): React.JSX.Element {
  const now = useNow(60_000)
  return (
    <div className="desktop-home-session-summary-row-wrap">
      <button
        type="button"
        className="desktop-home-session-summary-row"
        draggable
        onDragStart={(event) => {
          writeDesktopHomeSessionDragData(event.dataTransfer, {
            sessionId: session.id,
            ...(session.restoreTabId ? { tabId: session.restoreTabId } : {}),
            title: session.title,
            ...(session.executionHostId ? { executionHostId: session.executionHostId } : {})
          })
        }}
        onClick={() => onActivate(session)}
        data-session-id={session.id}
        title={`${session.title} · ${sessionStatusLabel(session.status)}`}
      >
        <MessageCircle aria-hidden />
        <span className="desktop-home-session-summary-copy">
          <span className="desktop-home-session-summary-title">{session.title}</span>
          <span className="desktop-home-session-summary-meta">
            <span
              className={cn(
                'desktop-home-session-summary-status',
                sessionStatusClass(session.status)
              )}
            />
            {sessionStatusLabel(session.status)}
          </span>
        </span>
        <span className="desktop-home-session-summary-time">
          {formatHomeRelativeTime(session.lastActivityAt, now, timeLabels)}
        </span>
        <ChevronRight className="desktop-home-tree-row-chevron" aria-hidden />
      </button>
      <button
        type="button"
        className="desktop-home-session-summary-save"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onSaveToProject(session)
        }}
        aria-label={translate('components.desktopHome.saveSessionToProject', 'Save to project')}
        title={translate(
          'components.desktopHome.saveSessionToProjectHint',
          'Choose the project that should own this session'
        )}
      >
        <FolderInput aria-hidden />
      </button>
    </div>
  )
}

export default function DesktopHomeSessionSummary({
  sessions,
  timeLabels,
  onActivate,
  onSaveToProject
}: {
  sessions: readonly DesktopHomeSession[]
  timeLabels: HomeRelativeTimeLabels
  onActivate: (session: DesktopHomeSession) => void
  onSaveToProject: (session: DesktopHomeSession) => void
}): React.JSX.Element {
  return (
    <section
      className="desktop-home-session-summary"
      aria-labelledby="desktop-home-session-heading"
    >
      <div className="desktop-home-session-summary-heading" id="desktop-home-session-heading">
        <span>
          <MessageCircle aria-hidden />
          {translate('components.desktopHome.sessionSummary', 'Temporary sessions')}
        </span>
        <span className="desktop-home-project-list-total">{sessions.length}</span>
      </div>
      {sessions.length > 0 ? (
        <div className="desktop-home-session-summary-list">
          {sessions.slice(0, 4).map((session) => (
            <SessionSummaryRow
              key={`${session.workspaceIdentityKey ?? session.scope?.type ?? 'standalone'}|${session.id}`}
              session={session}
              timeLabels={timeLabels}
              onActivate={onActivate}
              onSaveToProject={onSaveToProject}
            />
          ))}
        </div>
      ) : (
        <div className="desktop-home-session-summary-empty">
          <MessageCircle aria-hidden />
          <span>
            {translate(
              'components.desktopHome.noSessions',
              'No temporary sessions yet — start a new task to see them here.'
            )}
          </span>
        </div>
      )}
    </section>
  )
}
