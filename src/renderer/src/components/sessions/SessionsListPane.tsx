import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Archive, ChevronRight, Plus, Search, SearchX, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { SessionListViewState } from '../../../../shared/session-list-scope'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { partitionSessionList } from '../../../../shared/session-list-metadata'
import SessionListRow from './SessionListRow'
import type { SessionListItem, SessionProjectOption } from './session-list-types'
import SessionScopePicker from './SessionScopePicker'

export default function SessionsListPane({
  items: filteredItems,
  allItems,
  projects,
  view,
  updateView,
  onArchive
}: {
  items: readonly SessionListItem[]
  allItems: readonly SessionListItem[]
  projects: readonly SessionProjectOption[]
  view: SessionListViewState
  updateView: (patch: Partial<SessionListViewState>) => void
  onArchive?: (key: string) => void
}): React.JSX.Element {
  const metadata = useAppStore((state) => state.sessionListMetadata)
  const updateMetadata = useAppStore((state) => state.updateSessionListMetadata)
  const [archiveExpanded, setArchiveExpanded] = useState(false)
  const { active, archived } = useMemo(
    () => partitionSessionList(filteredItems, metadata),
    [filteredItems, metadata]
  )
  const items = archiveExpanded ? [...active, ...archived] : active
  const entries: (SessionListItem | null)[] = archived.length
    ? [...active, null, ...(archiveExpanded ? archived : [])]
    : active
  const scrollRef = useRef<HTMLDivElement>(null)
  const [highlightedKey, setHighlightedKey] = useState(view.selectedSessionKey)
  const openNewTaskHome = useAppStore((state) => state.openNewTaskHome)
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--sessions-row-height')
      ),
    overscan: 8,
    getItemKey: (index) => entries[index]?.key ?? 'archive-group',
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
    if (event.target !== event.currentTarget) {
      return
    }
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
    virtualizer.scrollToIndex(
      entries.findIndex((entry) => entry?.key === items[index].key),
      { align: 'auto' }
    )
  }
  const visibleRows = virtualizer.getVirtualItems()
  const optionId = (key: string): string => `session-option-${encodeURIComponent(key)}`
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
        <span className="session-count">{active.length}</span>
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
      {entries.length === 0 ? (
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
            highlightedKey && visibleRows.some((row) => entries[row.index]?.key === highlightedKey)
              ? optionId(highlightedKey)
              : undefined
          }
          onKeyDown={handleKeys}
          onScroll={(event) => updateView({ scrollTop: event.currentTarget.scrollTop })}
          data-testid="sessions-list-scroll"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {visibleRows.map((row) => {
              const item = entries[row.index]
              if (!item) {
                return (
                  <button
                    key="archive-group"
                    type="button"
                    className="session-archive-group"
                    ref={virtualizer.measureElement}
                    data-index={row.index}
                    style={{ transform: `translateY(${row.start}px)` }}
                    aria-expanded={archiveExpanded}
                    onClick={() => setArchiveExpanded((expanded) => !expanded)}
                  >
                    <Archive className="size-4" aria-hidden />
                    <span>{translate('components.sessions.archived', 'Archived')}</span>
                    <span className="session-count">{archived.length}</span>
                    <ChevronRight className="size-4" aria-hidden />
                  </button>
                )
              }
              return (
                <SessionListRow
                  key={item.key}
                  item={item}
                  rowRef={virtualizer.measureElement}
                  index={row.index}
                  offset={row.start}
                  optionId={optionId(item.key)}
                  selected={item.key === view.selectedSessionKey}
                  highlighted={item.key === highlightedKey}
                  pinned={metadata[item.key]?.pinned === true}
                  archived={metadata[item.key]?.archived === true}
                  onSelect={() => {
                    setHighlightedKey(item.key)
                    updateView({ selectedSessionKey: item.key })
                    scrollRef.current?.focus({ preventScroll: true })
                  }}
                  onPin={() => updateMetadata(item.key, { pinned: !metadata[item.key]?.pinned })}
                  onArchive={() => {
                    updateMetadata(item.key, { archived: !metadata[item.key]?.archived })
                    if (!metadata[item.key]?.archived) {
                      if (onArchive) {
                        onArchive(item.key)
                      } else if (item.key === view.selectedSessionKey) {
                        updateView({ selectedSessionKey: null })
                      }
                    }
                  }}
                />
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
