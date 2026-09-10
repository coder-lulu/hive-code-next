import { useLayoutEffect, useRef } from 'react'
import { ArrowLeft, FolderOpen, MessageSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import type { SessionListItem } from './session-list-types'
import SessionStatus, { SessionConnection } from './SessionStatus'
import SessionContent from './SessionContent'

export default function SessionDetail({
  item,
  onBack
}: {
  item: SessionListItem | null
  onBack: () => void
}): React.JSX.Element {
  const backRef = useRef<HTMLButtonElement>(null)
  const selectedKey = item?.key
  useLayoutEffect(() => {
    if (selectedKey && backRef.current?.getClientRects().length) {
      backRef.current.focus({ preventScroll: true })
    }
  }, [selectedKey])
  if (!item) {
    return (
      <section className="session-detail session-detail-empty">
        <MessageSquare className="size-8 text-muted-foreground" aria-hidden />
        <h2>{translate('components.sessions.select', 'Select a session')}</h2>
        <p>{translate('components.sessions.selectHint', 'Select a session to continue here.')}</p>
      </section>
    )
  }
  const agent = getAgentCatalog().find((entry) => entry.id === item.agent)
  return (
    <section className="session-detail" data-testid="session-detail">
      <header className="session-detail-header">
        <Button
          ref={backRef}
          variant="ghost"
          size="icon-sm"
          className="session-detail-back"
          onClick={onBack}
          aria-label={translate('components.sessions.backToList', 'Back to session list')}
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <div
          className="session-current-tab"
          role="tablist"
          aria-label={translate('components.sessions.title', 'Sessions')}
        >
          <button
            id="session-current-tab"
            role="tab"
            aria-selected="true"
            aria-controls="session-content"
            type="button"
          >
            <span className="session-tab-icon" title={agent?.label}>
              {agent ? (
                <AgentIcon agent={agent.id} size={16} />
              ) : (
                <SessionStatus status={item.status} iconOnly />
              )}
            </span>
            <h2 title={item.title}>{item.title}</h2>
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label={translate('components.sessions.closeView', 'Close session view')}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </header>
      <div className="session-context-bar">
        <span
          title={[item.projectLabel, item.workspacePath, item.hostLabel]
            .filter(Boolean)
            .join(' · ')}
          className="session-context-path"
        >
          <FolderOpen className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {[item.projectLabel, item.workspaceLabel].filter(Boolean).join(' / ') ||
              translate('components.sessions.unassigned', 'Unassigned')}
          </span>
        </span>
        <SessionStatus status={item.status} />
        <SessionConnection status={item.status} />
        <span className="session-host-label" title={item.hostLabel}>
          {item.hostLabel || translate('components.sessions.unknownHost', 'Unknown host')}
        </span>
      </div>
      {item.status.connection !== 'connected' && (
        <p className="session-availability-note">
          {translate(
            'components.sessions.hostHint',
            'Host connection is unavailable or unverified. The last known activity does not confirm that the session is still running.'
          )}
        </p>
      )}
      <SessionContent item={item} />
    </section>
  )
}
