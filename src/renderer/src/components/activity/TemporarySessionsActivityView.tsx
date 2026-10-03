import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, MessageCircle, Search, SearchX, Trash2 } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'

import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { selectExecutionHostDisplayLabel } from '@/lib/execution-host-display-label'
import { cn } from '@/lib/utils'
import { useTemporarySessionListActions } from '@/hooks/use-temporary-session-list-actions'
import {
  temporarySessionIdentityKey,
  useTemporarySessionCollection,
  type TemporarySessionItem
} from '@/hooks/use-temporary-session-collection'
import { useAppStore } from '@/store'

const TEMPORARY_SESSION_ROW_HEIGHT = 64
const TEMPORARY_SESSION_OVERSCAN = 8

function temporarySessionStatusLabel(status: TemporarySessionItem['status']): string {
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

function temporarySessionDotState(status: TemporarySessionItem['status']): AgentDotState {
  switch (status) {
    case 'running':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'completed':
      return 'done'
    case 'error':
      return 'failed'
  }
}

function temporarySessionTime(timestamp: number): string {
  if (timestamp <= 0) {
    return translate('components.desktopHome.time.unused', 'Not used yet')
  }
  return formatUiRelativeTime(timestamp - Date.now())
}

export function filterTemporarySessions(
  items: readonly TemporarySessionItem[],
  hostLabelByKey: ReadonlyMap<string, string>,
  query: string
): readonly TemporarySessionItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) {
    return items
  }
  return items.filter((item) => {
    const key = temporarySessionIdentityKey(item)
    const searchable = `${item.title} ${item.id} ${hostLabelByKey.get(key) ?? ''} ${temporarySessionStatusLabel(item.status)}`
    return searchable.toLocaleLowerCase().includes(normalizedQuery)
  })
}

function TemporarySessionRow({
  item,
  hostLabel,
  deleting,
  onOpen,
  onRequestDelete
}: {
  item: TemporarySessionItem
  hostLabel: string
  deleting: boolean
  onOpen: (item: TemporarySessionItem) => void
  onRequestDelete: (item: TemporarySessionItem) => void
}): React.JSX.Element {
  const status = temporarySessionStatusLabel(item.status)
  return (
    <div
      className={cn(
        'group flex h-16 min-w-0 items-center border-b border-border px-4',
        deleting && 'opacity-60'
      )}
      data-testid="temporary-session-row"
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-wait"
        onClick={() => onOpen(item)}
        disabled={deleting}
        aria-label={translate(
          'components.activity.temporarySessions.open',
          'Open temporary session {{title}}',
          { title: item.title }
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <MessageCircle className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <AgentStateDot state={temporarySessionDotState(item.status)} title={status} />
            <span className="shrink-0">{status}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{hostLabel}</span>
          </span>
        </span>
        <time
          className="shrink-0 text-xs text-muted-foreground"
          dateTime={
            item.lastActivityAt > 0
              ? (new Date(item.lastActivityAt).toJSON() ?? undefined)
              : undefined
          }
        >
          {temporarySessionTime(item.lastActivityAt)}
        </time>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-2 text-muted-foreground hover:text-destructive focus-visible:text-destructive"
        disabled={deleting}
        onClick={() => onRequestDelete(item)}
        aria-label={translate(
          'components.activity.temporarySessions.delete',
          'Delete temporary session {{title}}',
          { title: item.title }
        )}
        title={translate(
          'components.sidebar.sessions.deleteHint',
          'Close and delete this temporary session'
        )}
      >
        {deleting ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  )
}

function TemporarySessionList({
  items,
  hostLabelByKey,
  deletingSessionKeys,
  onOpen,
  onRequestDelete
}: {
  items: readonly TemporarySessionItem[]
  hostLabelByKey: ReadonlyMap<string, string>
  deletingSessionKeys: ReadonlySet<string>
  onOpen: (item: TemporarySessionItem) => void
  onRequestDelete: (item: TemporarySessionItem) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TEMPORARY_SESSION_ROW_HEIGHT,
    getItemKey: (index) => {
      const item = items[index]
      return item ? temporarySessionIdentityKey(item) : index
    },
    overscan: TEMPORARY_SESSION_OVERSCAN,
    initialRect: { width: 960, height: 512 }
  })

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto outline-none scrollbar-sleek focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      role="region"
      aria-label={translate(
        'components.activity.temporarySessions.scrollRegion',
        'Scrollable temporary sessions'
      )}
      tabIndex={0}
    >
      <ul
        className="relative min-w-0"
        style={{ height: virtualizer.getTotalSize() }}
        aria-label={translate(
          'components.activity.temporarySessions.listLabel',
          'Temporary sessions'
        )}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index]
          if (!item) {
            return null
          }
          const key = temporarySessionIdentityKey(item)
          return (
            <li
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              aria-posinset={virtualRow.index + 1}
              aria-setsize={items.length}
            >
              <TemporarySessionRow
                item={item}
                hostLabel={hostLabelByKey.get(key) ?? ''}
                deleting={deletingSessionKeys.has(key)}
                onOpen={onOpen}
                onRequestDelete={onRequestDelete}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function TemporarySessionsActivityView(): React.JSX.Element {
  useTranslation()
  const headingId = useId()
  const [query, setQuery] = useState('')
  const { items, totalCount } = useTemporarySessionCollection()
  const { deletingSessionKeys, openSession, requestDelete } = useTemporarySessionListActions()
  const localHostLabel = translate('components.activity.temporarySessions.localHost', 'Local')
  const hostLabelSources = useAppStore(
    useShallow((state) => ({
      settings: state.settings,
      runtimeEnvironments: state.runtimeEnvironments,
      sshTargetLabels: state.sshTargetLabels,
      removedSshTargetLabels: state.removedSshTargetLabels
    }))
  )
  const hostLabelByKey = useMemo(() => {
    void hostLabelSources
    const state = useAppStore.getState()
    return new Map(
      items.map((item) => [
        temporarySessionIdentityKey(item),
        item.executionHostId
          ? selectExecutionHostDisplayLabel(state, item.executionHostId)
          : localHostLabel
      ])
    )
  }, [hostLabelSources, items, localHostLabel])
  const filteredItems = filterTemporarySessions(items, hostLabelByKey, query)

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-labelledby={headingId}>
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 id={headingId} className="truncate text-base font-semibold text-foreground">
                {translate('components.sidebar.sessions.title', 'Temporary sessions')}
              </h1>
              <span
                className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                data-testid="temporary-session-count"
              >
                {totalCount}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {translate(
                'components.activity.temporarySessions.description',
                'Open or delete restorable sessions that are not assigned to a project.'
              )}
            </p>
          </div>
          <div className="relative w-full shrink-0 sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 pl-8 text-xs"
              aria-label={translate(
                'components.activity.temporarySessions.search',
                'Search temporary sessions'
              )}
              placeholder={translate(
                'components.activity.temporarySessions.searchPlaceholder',
                'Search {{count}} sessions…',
                { count: totalCount }
              )}
            />
          </div>
        </div>
      </header>

      {filteredItems.length > 0 ? (
        <TemporarySessionList
          items={filteredItems}
          hostLabelByKey={hostLabelByKey}
          deletingSessionKeys={deletingSessionKeys}
          onOpen={openSession}
          onRequestDelete={requestDelete}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
          <div className="max-w-sm text-muted-foreground">
            {totalCount === 0 ? (
              <MessageCircle className="mx-auto size-7" aria-hidden />
            ) : (
              <SearchX className="mx-auto size-7" aria-hidden />
            )}
            <p className="mt-3 text-sm font-medium text-foreground">
              {totalCount === 0
                ? translate('components.activity.temporarySessions.empty', 'No temporary sessions')
                : translate(
                    'components.activity.temporarySessions.noMatches',
                    'No matching temporary sessions'
                  )}
            </p>
            <p className="mt-1 text-xs">
              {totalCount === 0
                ? translate(
                    'components.activity.temporarySessions.emptyDescription',
                    'Unassigned sessions will appear here while they can still be reopened.'
                  )
                : translate(
                    'components.activity.temporarySessions.noMatchesDescription',
                    'Try a different title, status, or host.'
                  )}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
