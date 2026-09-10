import { useLayoutEffect, useRef, useState } from 'react'
import { MessageSquare, Plus, Search, SearchX, TerminalSquare, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { SessionListViewState } from '../../../../shared/session-list-scope'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { useAppStore } from '@/store'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { useNow } from '@/hooks/use-now'
import type { SessionListItem, SessionProjectOption } from './session-list-types'
import SessionScopePicker from './SessionScopePicker'
import SessionStatus, { SessionConnection } from './SessionStatus'

function SessionTime({ timestamp }: { timestamp: number }): React.JSX.Element | null {
  const now = useNow(60_000, timestamp > 0)
  const date = new Date(timestamp)
  if (timestamp <= 0 || !Number.isFinite(date.getTime())) {
    return null
  }
  return (
    <time className="session-row-time" dateTime={date.toISOString()}>
      {formatUiRelativeTime(timestamp - now)}
    </time>
  )
}

export default function SessionsListPane({
  items,
  allItems,
  projects,
  view,
  updateView
}: {
  items: readonly SessionListItem[]
  allItems: readonly SessionListItem[]
  projects: readonly SessionProjectOption[]
  view: SessionListViewState
  updateView: (patch: Partial<SessionListViewState>) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [highlightedKey, setHighlightedKey] = useState(view.selectedSessionKey)
  const openNewTaskHome = useAppStore((state) => state.openNewTaskHome)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--sessions-row-height')
      ),
    overscan: 8,
    getItemKey: (index) => items[index].key,
    initialOffset: view.scrollTop
  })
  const previousFilter = useRef(`${JSON.stringify(view.scope)}|${view.query}`)
  useLayoutEffect(() => {
    const filter = `${JSON.stringify(view.scope)}|${view.query}`
    if (previousFilter.current !== filter) {
      virtualizer.scrollToOffset(0)
      previousFilter.current = filter
    }
  }, [view.scope, view.query, virtualizer])
  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' && items.some((item) => item.key === highlightedKey)) {
      event.preventDefault()
      updateView({ selectedSessionKey: highlightedKey })
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) {
      return
    }
    event.preventDefault()
    const current = items.findIndex((item) => item.key === highlightedKey)
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : Math.max(0, Math.min(items.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
    setHighlightedKey(items[index].key)
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }
  const visibleRows = virtualizer.getVirtualItems()
  const optionId = (key: string): string => `session-option-${encodeURIComponent(key)}`
  const agents = getAgentCatalog()
  return (
    <aside
      className="sessions-list-pane"
      aria-label={translate('components.sessions.current', 'Current restorable sessions')}
    >
      <div className="sessions-list-heading">
        <SessionScopePicker
          scope={view.scope}
          items={allItems}
          projects={projects}
          onChange={(scope) => updateView({ scope })}
        />
        <span className="session-count">{items.length}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => openNewTaskHome()}
          aria-label={translate('components.sessions.new', 'New session')}
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="sessions-search">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          aria-label={translate('components.sessions.search', 'Search sessions')}
          placeholder={translate('components.sessions.searchPlaceholder', 'Search sessions…')}
          value={view.query}
          onChange={(event) => updateView({ query: event.target.value, scrollTop: 0 })}
          className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
        {view.query && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => updateView({ query: '', scrollTop: 0 })}
            aria-label={translate('components.sessions.clearSearch', 'Clear search')}
          >
            <X className="size-3" aria-hidden />
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="sessions-list-empty">
          <SearchX className="size-6 text-muted-foreground" aria-hidden />
          <p>{translate('components.sessions.noMatches', 'No sessions in this view')}</p>
          <span>
            {view.query
              ? translate(
                  'components.sessions.trySearch',
                  'Try another title, project, workspace or host.'
                )
              : translate(
                  'components.sessions.loadedOnly',
                  'Only currently loaded, restorable sessions are shown.'
                )}
          </span>
          {!allItems.length && (
            <Button size="sm" onClick={() => openNewTaskHome()}>
              <Plus className="size-4" aria-hidden />
              {translate('components.sessions.new', 'New session')}
            </Button>
          )}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="sessions-list-scroll"
          role="listbox"
          tabIndex={0}
          aria-label={translate('components.sessions.title', 'Sessions')}
          aria-activedescendant={
            highlightedKey && visibleRows.some((row) => items[row.index].key === highlightedKey)
              ? optionId(highlightedKey)
              : undefined
          }
          onKeyDown={handleKeys}
          onScroll={(event) => updateView({ scrollTop: event.currentTarget.scrollTop })}
          data-testid="sessions-list-scroll"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {visibleRows.map((row) => {
              const item = items[row.index]
              const Icon = item.kind === 'structured' ? MessageSquare : TerminalSquare
              const agent = agents.find((entry) => entry.id === item.agent)
              const context = [item.hostLabel, item.workspaceLabel ?? item.projectLabel]
                .filter(Boolean)
                .join(' · ')
              return (
                <button
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  id={optionId(item.key)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={item.key === view.selectedSessionKey}
                  data-highlighted={item.key === highlightedKey}
                  key={item.key}
                  className="session-center-row"
                  style={{ transform: `translateY(${row.start}px)` }}
                  onClick={() => {
                    setHighlightedKey(item.key)
                    updateView({ selectedSessionKey: item.key })
                    scrollRef.current?.focus({ preventScroll: true })
                  }}
                  title={[
                    item.title,
                    item.agent,
                    item.projectLabel,
                    item.workspaceLabel,
                    item.hostLabel
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  data-testid="session-center-row"
                  data-session-key={item.key}
                >
                  <span
                    className="session-row-icon size-4 shrink-0"
                    title={agent?.label ?? item.agent ?? undefined}
                    aria-label={agent?.label ?? item.agent ?? undefined}
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
                      <SessionTime timestamp={item.lastActivityAt} />
                    </span>
                    <span className="session-row-meta">
                      <SessionStatus status={item.status} />
                      <SessionConnection status={item.status} />
                      <span className="truncate">{context}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <p className="sessions-list-footnote">
        {translate('components.sessions.current', 'Current restorable sessions')}
      </p>
    </aside>
  )
}
