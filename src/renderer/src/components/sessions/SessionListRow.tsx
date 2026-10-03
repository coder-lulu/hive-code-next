import {
  Archive,
  ArchiveRestore,
  MessageSquare,
  Pin,
  PinOff,
  TerminalSquare,
  Square,
  LoaderCircle
} from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import { useCallback, useRef, useState } from 'react'
import { deleteTemporarySession } from '@/lib/temporary-session-actions'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { useNow } from '@/hooks/use-now'
import type { SessionListItem } from './session-list-types'
import SessionStatus, { SessionConnection } from './SessionStatus'

export default function SessionListRow({
  item,
  rowRef,
  index,
  offset,
  optionId,
  selected,
  highlighted,
  pinned,
  archived,
  onSelect,
  onPin,
  onArchive
}: {
  item: SessionListItem
  rowRef: (element: HTMLDivElement | null) => void
  index: number
  offset: number
  optionId: string
  selected: boolean
  highlighted: boolean
  pinned: boolean
  archived: boolean
  onSelect: () => void
  onPin: () => void
  onArchive: () => void
}): React.JSX.Element {
  const [terminating, setTerminating] = useState(false)
  const terminationPending = useRef(false)
  const terminateLabel = translate('components.sessions.terminate', 'Terminate session')
  const terminate = async () => {
    if (!archived || terminationPending.current) {
      return
    }
    terminationPending.current = true
    setTerminating(true)
    try {
      const handled = await deleteTemporarySession(
        {
          ownerBucketKey: item.ownerBucketKey,
          executionHostId: item.executionHostId,
          unifiedTabId: item.unifiedTabId,
          terminalTabId: item.terminalTabId,
          tabId: item.tabId,
          sessionId: item.providerSessionId
        },
        { allowWorkspaceOwner: true }
      )
      if (!handled) {
        throw new Error('Session owner is no longer available')
      }
    } catch {
      toast.error(
        translate(
          'components.sessions.terminateFailed',
          'Could not terminate this session. Check its host connection and try again.'
        )
      )
    } finally {
      terminationPending.current = false
      setTerminating(false)
    }
  }
  const drag = useDraggable({ id: `session-list:${item.key}`, data: { sessionKey: item.key } })
  const { setNodeRef } = drag
  const setRowRef = useCallback(
    (node: HTMLDivElement | null) => {
      rowRef(node)
      setNodeRef(node)
    },
    [rowRef, setNodeRef]
  )
  const now = useNow(60_000, item.lastActivityAt > 0)
  const date = new Date(item.lastActivityAt)
  const agent = getAgentCatalog().find((entry) => entry.id === item.agent)
  const Icon = item.kind === 'structured' ? MessageSquare : TerminalSquare
  const context = [item.hostLabel, item.workspaceLabel ?? item.projectLabel]
    .filter(Boolean)
    .join(' · ')
  const pinLabel = pinned
    ? translate('components.sessions.unpin', 'Unpin session')
    : translate('components.sessions.pin', 'Pin session')
  const archiveLabel = archived
    ? translate('components.sessions.restore', 'Unarchive session')
    : translate('components.sessions.archive', 'Archive session')
  return (
    <div
      ref={setRowRef}
      data-index={index}
      className="session-center-row"
      style={{ transform: `translateY(${offset}px)` }}
      data-highlighted={highlighted}
      aria-selected={selected}
      data-testid="session-center-row"
      data-session-key={item.key}
    >
      <button
        {...drag.attributes}
        {...drag.listeners}
        type="button"
        role="option"
        id={optionId}
        tabIndex={-1}
        aria-selected={selected}
        className="session-row-select"
        onClick={onSelect}
        title={[item.title, item.projectLabel, item.workspaceLabel, item.hostLabel]
          .filter(Boolean)
          .join(' · ')}
      >
        <span
          className="session-row-icon size-4 shrink-0"
          title={agent?.label ?? item.agent ?? undefined}
        >
          {agent ? (
            <AgentIcon agent={agent.id} size={16} />
          ) : (
            <Icon className="size-4" aria-hidden />
          )}
        </span>
        <span className="session-row-copy">
          <span className="session-row-top">
            <span className="session-row-title">{item.title}</span>
            {pinned && <Pin className="session-row-pin size-3 shrink-0" aria-label={pinLabel} />}
            {item.lastActivityAt > 0 && Number.isFinite(date.getTime()) && (
              <time className="session-row-time" dateTime={date.toISOString()}>
                {formatUiRelativeTime(item.lastActivityAt - now)}
              </time>
            )}
          </span>
          <span className="session-row-meta">
            <SessionStatus status={item.status} />
            <SessionConnection status={item.status} />
            <span className="truncate">{context}</span>
          </span>
        </span>
      </button>
      <span className="session-row-actions">
        {archived ? (
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={terminating}
            onClick={() => void terminate()}
            aria-label={terminateLabel}
            title={terminateLabel}
            className="text-destructive hover:text-destructive"
          >
            {terminating ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Square className="size-3.5" aria-hidden />
            )}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onPin}
            aria-label={pinLabel}
            title={pinLabel}
            aria-pressed={pinned}
          >
            {pinned ? (
              <PinOff className="size-3.5" aria-hidden />
            ) : (
              <Pin className="size-3.5" aria-hidden />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onArchive}
          aria-label={archiveLabel}
          title={archiveLabel}
        >
          {archived ? (
            <ArchiveRestore className="size-3.5" aria-hidden />
          ) : (
            <Archive className="size-3.5" aria-hidden />
          )}
        </Button>
      </span>
    </div>
  )
}
