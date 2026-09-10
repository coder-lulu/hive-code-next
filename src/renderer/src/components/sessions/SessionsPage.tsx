import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { filterSessionInventory } from './session-list-model'
import { useSessionCollection } from './use-session-collection'
import SessionsListPane from './SessionsListPane'
import SessionDetail from './SessionDetail'
import { DndContext } from '@dnd-kit/core'
import { createPortal } from 'react-dom'
import TabGroupSplitLayout from '../tab-group/TabGroupSplitLayout'
import TabPaneColumnSplitDragOverlay from '../tab-group/TabPaneColumnSplitDragOverlay'
import { TabDragProvider } from '../tab-group/tab-drag-context'
import { useSessionPanels } from './use-session-panels'
import { useSessionPanelDrag } from './use-session-panel-drag'

export default function SessionsPage({
  reserveTopChrome = false
}: {
  reserveTopChrome?: boolean
}): React.JSX.Element {
  useTranslation()
  const { items, projects } = useSessionCollection()
  const view = useAppStore((state) => state.sessionsView)
  const updateView = useAppStore((state) => state.updateSessionsView)
  const filtered = useMemo(
    () => filterSessionInventory(items, view.scope, view.query),
    [items, view.scope, view.query]
  )
  const panelItemsByKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])
  const selected = panelItemsByKey.get(view.selectedSessionKey ?? '') ?? null
  const select = useCallback(
    (key: string | null) => updateView({ selectedSessionKey: key }),
    [updateView]
  )
  const panel = useSessionPanels(items, view.selectedSessionKey, select)
  const back = () => select(null)
  const drag = useSessionPanelDrag(panel.open)
  const isDraggingRef = useRef(false)
  isDraggingRef.current = drag.activeKey !== null
  const pageRef = useRef<HTMLElement>(null)
  const previousSelection = useRef(view.selectedSessionKey)
  useLayoutEffect(() => {
    if (previousSelection.current && !view.selectedSessionKey) {
      pageRef.current
        ?.querySelector<HTMLElement>('[role="listbox"]')
        ?.focus({ preventScroll: true })
    }
    previousSelection.current = view.selectedSessionKey
  }, [view.selectedSessionKey])
  return (
    <DndContext
      sensors={drag.sensors}
      onDragStart={drag.onDragStart}
      onDragMove={drag.onDragMove}
      onDragEnd={drag.onDragEnd}
      onDragCancel={drag.onDragCancel}
      autoScroll={false}
    >
      <TabDragProvider isTabDragActive={Boolean(drag.activeKey)} isTabDragActiveRef={isDraggingRef}>
        <main
          ref={pageRef}
          className="sessions-page"
          data-testid="sessions-page"
          data-has-selection={selected !== null}
          data-reserve-top-chrome={reserveTopChrome}
        >
          <h1 className="sr-only">{translate('components.sessions.title', 'Sessions')}</h1>
          <div className="sessions-layout">
            <SessionsListPane
              items={filtered}
              allItems={items}
              projects={projects}
              view={view}
              onArchive={panel.close}
              updateView={(patch) => {
                if (patch.selectedSessionKey) {
                  panel.open(patch.selectedSessionKey)
                }
                updateView(patch)
              }}
            />
            <div className="session-panel-workspace" data-dragging={Boolean(drag.activeKey)}>
              {selected && panel.panels.layout ? (
                <TabGroupSplitLayout
                  layout={panel.panels.layout}
                  worktreeId=""
                  isWorktreeActive={false}
                  focusedGroupId={panel.panels.focusedGroupId ?? undefined}
                  surface={{
                    isDragging: Boolean(drag.activeKey),
                    onRatioChange: panel.resize,
                    renderGroup: (groupId, edges) => {
                      const group = panel.panels.groups.find(
                        (candidate) => candidate.id === groupId
                      )!
                      const groupItems = group.keys.flatMap((key) => panelItemsByKey.get(key) ?? [])
                      const activeItem =
                        groupItems.find((item) => item.key === group.activeKey) ?? null
                      return (
                        <SessionDetail
                          item={activeItem}
                          groupId={groupId}
                          reserveTopChrome={edges.top && edges.right}
                          tabItems={groupItems}
                          isFocused={groupId === panel.panels.focusedGroupId}
                          onFocus={() => panel.focus(groupId)}
                          onActivate={(key) => panel.open(key)}
                          onClose={panel.close}
                          onBack={back}
                        />
                      )
                    }
                  }}
                />
              ) : (
                <SessionDetail item={null} onBack={back} />
              )}
            </div>
          </div>
        </main>
        {drag.activeKey &&
          drag.pointer &&
          createPortal(
            <div
              className="session-drag-preview pointer-events-none fixed z-[10001]"
              aria-hidden
              style={{ left: drag.pointer.x, top: drag.pointer.y }}
            >
              {items.find((item) => item.key === drag.activeKey)?.title}
            </div>,
            document.body
          )}
        {drag.target && drag.target.zone !== 'center' && (
          <TabPaneColumnSplitDragOverlay
            panelRect={drag.target.panelRect}
            zone={drag.target.zone}
          />
        )}
      </TabDragProvider>
    </DndContext>
  )
}
