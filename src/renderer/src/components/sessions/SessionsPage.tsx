import { useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { filterSessionInventory } from './session-list-model'
import { useSessionCollection } from './use-session-collection'
import SessionsListPane from './SessionsListPane'
import SessionDetail from './SessionDetail'

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
  const selected = items.find((item) => item.key === view.selectedSessionKey) ?? null
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
          updateView={updateView}
        />
        <SessionDetail item={selected} onBack={() => updateView({ selectedSessionKey: null })} />
      </div>
    </main>
  )
}
