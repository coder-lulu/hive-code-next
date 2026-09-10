import { useEffect, useLayoutEffect, useRef } from 'react'
import { ArrowLeft, ArrowUpRight, FolderOpen, MessageSquare, TerminalSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { requestBackgroundTerminalWorktreeMount } from '@/components/terminal/background-terminal-worktree-mount'
import { runtimeTargetForExecutionHostId } from '@/runtime/runtime-client-target'
import { sessionDetailAnchorStyle } from './session-detail-anchor'
import type { SessionListItem } from './session-list-types'
import SessionStatus, { SessionConnection } from './SessionStatus'
import { useOpenSession } from './use-open-session'

export default function SessionDetail({
  item,
  onBack
}: {
  item: SessionListItem | null
  onBack: () => void
}): React.JSX.Element {
  const { openingKey, openSession } = useOpenSession()
  const backRef = useRef<HTMLButtonElement>(null)
  const selectedKey = item?.key
  useLayoutEffect(() => {
    if (selectedKey && backRef.current?.getClientRects().length) {
      backRef.current.focus({ preventScroll: true })
    }
  }, [selectedKey])
  const canShowChat =
    item?.kind === 'structured' &&
    item.executionHostId !== null &&
    runtimeTargetForExecutionHostId(item.executionHostId) !== null
  useEffect(() => {
    if (canShowChat && item?.ownerBucketKey && item.unifiedTabId) {
      requestBackgroundTerminalWorktreeMount({
        worktreeId: item.ownerBucketKey,
        tabIds: [item.unifiedTabId]
      })
    }
  }, [canShowChat, item?.ownerBucketKey, item?.unifiedTabId])
  if (!item) {
    return (
      <section className="session-detail session-detail-empty">
        <MessageSquare className="size-8 text-muted-foreground" aria-hidden />
        <h2>{translate('components.sessions.select', 'Select a session')}</h2>
        <p>
          {translate(
            'components.sessions.selectHint',
            'Read a conversation or return to its workspace to continue.'
          )}
        </p>
      </section>
    )
  }
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
        <h2 title={item.title}>{item.title}</h2>
        <Button
          variant="outline"
          size="sm"
          className="session-open-workspace"
          aria-label={translate('components.sessions.openWorkspace', 'Open workspace')}
          disabled={openingKey !== null}
          onClick={() => void openSession(item)}
        >
          <ArrowUpRight className="size-4" aria-hidden />
          <span>{translate('components.sessions.openWorkspace', 'Open workspace')}</span>
        </Button>
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
        <span className="session-host-label" title={item.hostLabel}>
          {item.hostLabel || translate('components.sessions.unknownHost', 'Unknown host')}
        </span>
        <SessionStatus status={item.status} />
        <SessionConnection status={item.status} />
        {item.agent && <span>{item.agent}</span>}
      </div>
      {item.status.connection !== 'connected' && (
        <p className="session-availability-note">
          {translate(
            'components.sessions.hostHint',
            'Host connection is unavailable or unverified. The last known activity does not confirm that the session is still running.'
          )}
        </p>
      )}
      {canShowChat ? (
        <div
          className="session-chat-anchor"
          style={sessionDetailAnchorStyle}
          data-testid="session-chat-anchor"
        />
      ) : (
        <div className="session-terminal-detail">
          <TerminalSquare className="size-9 text-muted-foreground" aria-hidden />
          <h3>{translate('components.sessions.continueWorkspace', 'Continue in the workspace')}</h3>
          <p>
            {translate(
              'components.sessions.terminalHint',
              'This session uses its workspace terminal. Open the workspace to continue with the existing terminal and layout.'
            )}
          </p>
          <dl>
            <div>
              <dt>{translate('components.sessions.workspace', 'Workspace')}</dt>
              <dd>
                {item.workspacePath ??
                  item.workspaceLabel ??
                  translate('components.sessions.unassigned', 'Unassigned')}
              </dd>
            </div>
            <div>
              <dt>{translate('components.sessions.host', 'Host')}</dt>
              <dd>
                {item.hostLabel || translate('components.sessions.unknownHost', 'Unknown host')}
              </dd>
            </div>
          </dl>
          <Button disabled={openingKey !== null} onClick={() => void openSession(item)}>
            <ArrowUpRight className="size-4" aria-hidden />
            {translate('components.sessions.openWorkspace', 'Open workspace')}
          </Button>
        </div>
      )}
    </section>
  )
}
