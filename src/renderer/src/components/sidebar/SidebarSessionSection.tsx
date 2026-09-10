import React from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Activity,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  MessageCircle,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  XCircle
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import {
  getSidebarActiveSessionTarget,
  isSidebarSessionActive
} from './sidebar-session-active-target'
export {
  getSidebarActiveSessionTarget,
  isSidebarSessionActive,
  type SidebarActiveSessionTarget
} from './sidebar-session-active-target'
import {
  temporarySessionIdentityKey,
  useTemporarySessionCollection,
  type TemporarySessionItem
} from '@/hooks/use-temporary-session-collection'
import { useTemporarySessionListActions } from '@/hooks/use-temporary-session-list-actions'
import { useNow } from '@/hooks/use-now'
import { formatHomeRelativeTime } from '../landing/desktop-home-model-utils'
import { translate } from '@/i18n/i18n'
import { writeDesktopHomeSessionDragData } from '../landing/desktop-home-session-drag'
import { isSidebarTemporarySession, type SidebarSessionStatus } from './sidebar-session-model'

export {
  activateTemporarySession as activateSidebarSession,
  confirmTemporarySessionDeletion as confirmSidebarSessionDeletion
} from '@/hooks/use-temporary-session-list-actions'

function statusIcon(status: SidebarSessionStatus): React.JSX.Element {
  if (status === 'running') {
    return <Activity className="sidebar-session-status-icon is-running" aria-hidden />
  }
  if (status === 'waiting') {
    return <RotateCcw className="sidebar-session-status-icon is-waiting" aria-hidden />
  }
  if (status === 'error') {
    return <XCircle className="sidebar-session-status-icon is-error" aria-hidden />
  }
  return <CircleCheck className="sidebar-session-status-icon is-completed" aria-hidden />
}

function statusLabel(status: SidebarSessionStatus): string {
  switch (status) {
    case 'running':
      return translate('components.sidebar.sessions.status.running', 'Running')
    case 'waiting':
      return translate('components.sidebar.sessions.status.waiting', 'Waiting')
    case 'completed':
      return translate('components.sidebar.sessions.status.completed', 'Completed')
    case 'error':
      return translate('components.sidebar.sessions.status.error', 'Needs attention')
  }
}

export function SessionRow({
  item,
  timeLabels,
  onOpen,
  onRequestDelete,
  deleting,
  active = false,
  now
}: {
  item: TemporarySessionItem
  timeLabels: Parameters<typeof formatHomeRelativeTime>[2]
  onOpen: (item: TemporarySessionItem) => void
  onRequestDelete: (item: TemporarySessionItem) => void
  deleting: boolean
  active?: boolean
  now: number
}): React.JSX.Element {
  const temporary = isSidebarTemporarySession(item)
  const context = item.contextLabel
    ? item.contextLabel
    : temporary
      ? translate('components.sidebar.sessions.temporary', 'Temporary session')
      : translate('components.sidebar.sessions.workspaceSession', 'Workspace session')
  return (
    <div className="sidebar-session-row-wrap">
      <button
        type="button"
        className={`sidebar-session-row${active ? ' is-active' : ''}`}
        onClick={() => onOpen(item)}
        disabled={deleting}
        title={`${item.title} · ${statusLabel(item.status)}`}
        aria-current={active ? 'page' : undefined}
        data-active={active ? 'true' : undefined}
        data-session-id={item.id}
        data-session-worktree={item.worktreeId ?? undefined}
      >
        <span
          className="sidebar-session-row-icon sidebar-session-row-drag-handle"
          draggable={!deleting}
          onDragStart={(event) => {
            writeDesktopHomeSessionDragData(event.dataTransfer, {
              sessionId: item.id,
              ...(item.tabId ? { tabId: item.tabId } : {}),
              title: item.title,
              ...(item.executionHostId ? { executionHostId: item.executionHostId } : {})
            })
          }}
          aria-hidden
        >
          <MessageCircle />
        </span>
        <span className="sidebar-session-row-copy">
          <span className="sidebar-session-row-title">{item.title}</span>
          <span className="sidebar-session-row-meta">
            <span className="sidebar-session-row-context">{context}</span>
            <span aria-hidden>·</span>
            <span className="sidebar-session-row-status">
              {statusIcon(item.status)}
              <span className="sr-only">{statusLabel(item.status)}</span>
            </span>
          </span>
        </span>
        <span className="sidebar-session-row-time">
          {formatHomeRelativeTime(item.lastActivityAt, now, timeLabels)}
        </span>
      </button>
      {temporary && item.tabId ? (
        <span className="sidebar-session-row-actions">
          <button
            type="button"
            className="sidebar-session-row-action is-delete"
            disabled={deleting}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onRequestDelete(item)
            }}
            aria-label={translate('components.sidebar.sessions.delete', 'Delete temporary session')}
            title={translate(
              'components.sidebar.sessions.deleteHint',
              'Close and delete this temporary session'
            )}
          >
            {deleting ? (
              <LoaderCircle className="is-spinning" aria-hidden />
            ) : (
              <Trash2 aria-hidden />
            )}
          </button>
        </span>
      ) : null}
    </div>
  )
}

export function sidebarSessionIdentityKey(
  item: Pick<TemporarySessionItem, 'id' | 'ownerBucketKey' | 'worktreeId'>
): string {
  return temporarySessionIdentityKey(item)
}

export default function SidebarSessionSection(): React.JSX.Element {
  useTranslation()
  const { items, totalCount } = useTemporarySessionCollection({ limit: 4 })
  const now = useNow(60_000, totalCount > 0)
  const { deletingSessionKeys, openSession, requestDelete } = useTemporarySessionListActions()
  const openNewTaskHome = useAppStore((state) => state.openNewTaskHome)
  const openActivityPage = useAppStore((state) => state.openActivityPage)
  const activeSessionTarget = useAppStore(useShallow(getSidebarActiveSessionTarget))
  const timeLabels = {
    unused: translate('components.desktopHome.time.unused', 'Not used yet'),
    justNow: translate('components.desktopHome.time.justNow', 'Just now'),
    minutesAgo: (value: number) =>
      translate('components.desktopHome.time.minutesAgo', '{{value}} min ago', { value }),
    hoursAgo: (value: number) =>
      translate('components.desktopHome.time.hoursAgo', '{{value}} hr ago', { value }),
    daysAgo: (value: number) =>
      translate('components.desktopHome.time.daysAgo', '{{value}} days ago', { value })
  }
  return (
    <section
      className="sidebar-session-section"
      aria-label={translate('components.sidebar.sessions.title', 'Temporary sessions')}
      data-testid="sidebar-session-section"
    >
      <header className="sidebar-hierarchy-heading">
        <div className="sidebar-hierarchy-heading-label">
          <MessageCircle aria-hidden />
          <span>{translate('components.sidebar.sessions.title', 'Temporary sessions')}</span>
          {totalCount > 0 ? <span className="sidebar-hierarchy-count">{totalCount}</span> : null}
        </div>
        <div className="sidebar-hierarchy-heading-actions">
          {totalCount > 0 ? (
            <button
              type="button"
              className="sidebar-hierarchy-link"
              onClick={() => openActivityPage?.({ scope: 'temporary-sessions' })}
            >
              {translate('components.sidebar.sessions.viewAll', 'View all')}
            </button>
          ) : null}
          <button
            type="button"
            className="sidebar-hierarchy-icon-button"
            onClick={() => openNewTaskHome?.()}
            aria-label={translate('components.sidebar.sessions.new', 'New session')}
            title={translate('components.sidebar.sessions.new', 'New session')}
          >
            <Plus aria-hidden />
          </button>
        </div>
      </header>
      <div className="sidebar-session-list">
        {items.length > 0 ? (
          items.map((item) => (
            <SessionRow
              key={sidebarSessionIdentityKey(item)}
              item={item}
              timeLabels={timeLabels}
              onOpen={openSession}
              onRequestDelete={requestDelete}
              deleting={deletingSessionKeys.has(sidebarSessionIdentityKey(item))}
              active={isSidebarSessionActive(item, activeSessionTarget)}
              now={now}
            />
          ))
        ) : (
          <button
            type="button"
            className="sidebar-session-empty"
            onClick={() => openNewTaskHome?.()}
          >
            <Search aria-hidden />
            <span>
              {translate('components.sidebar.sessions.empty', 'No temporary sessions yet')}
            </span>
            <CircleAlert aria-hidden />
          </button>
        )}
      </div>
    </section>
  )
}
