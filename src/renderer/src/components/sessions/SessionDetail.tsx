import { useLayoutEffect, useRef } from 'react'
import { ArrowLeft, FolderOpen, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import SessionPanelTab from './SessionPanelTab'
import type { SessionListItem } from './session-list-types'
import SessionStatus, { SessionConnection } from './SessionStatus'
import SessionContent from './SessionContent'

export default function SessionDetail({
  item,
  onBack,
  groupId,
  tabItems,
  isFocused = true,
  onActivate,
  onClose,
  onFocus,
  reserveTopChrome = true
}: {
  item: SessionListItem | null
  onBack: () => void
  groupId?: string
  tabItems?: SessionListItem[]
  isFocused?: boolean
  onActivate?: (key: string) => void
  onClose?: (key: string) => void
  onFocus?: () => void
  reserveTopChrome?: boolean
}): React.JSX.Element {
  const backRef = useRef<HTMLButtonElement>(null)
  const selectedKey = item?.key
  useLayoutEffect(() => {
    if (isFocused && selectedKey && backRef.current?.getClientRects().length) {
      backRef.current.focus({ preventScroll: true })
    }
  }, [selectedKey, isFocused])
  if (!item) {
    return (
      <section className="session-detail session-detail-empty" data-session-panel="">
        <MessageSquare className="size-8 text-muted-foreground" aria-hidden />
        <h2>{translate('components.sessions.select', 'Select a session')}</h2>
        <p>{translate('components.sessions.selectHint', 'Select a session to continue here.')}</p>
      </section>
    )
  }
  return (
    <section
      className="session-detail"
      data-testid="session-detail"
      data-session-panel={groupId}
      data-focused={isFocused}
      data-panel-top-right={reserveTopChrome}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
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
          className="session-panel-tabs"
          role="tablist"
          aria-label={translate('components.sessions.title', 'Sessions')}
        >
          {(tabItems ?? [item]).map((tabItem) => (
            <SessionPanelTab
              key={tabItem.key}
              item={tabItem}
              groupId={groupId}
              selected={tabItem.key === item.key}
              onActivate={() => onActivate?.(tabItem.key)}
              onClose={() => (onClose ? onClose(tabItem.key) : onBack())}
            />
          ))}
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
      <SessionContent item={item} groupId={groupId} isFocused={isFocused} onFocus={onFocus} />
    </section>
  )
}
