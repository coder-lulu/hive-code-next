// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionListItem } from './session-list-types'
vi.mock('@dnd-kit/core', () => ({ useDraggable: () => ({ setNodeRef: vi.fn() }) }))
vi.mock('@/lib/agent-catalog', () => ({ getAgentCatalog: () => [], AgentIcon: () => null }))
vi.mock('./SessionStatus', () => ({ default: () => null }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
import SessionPanelTab from './SessionPanelTab'
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('reveals a newly selected clipped tab without scrolling the content vertically', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return (
        this.classList.contains('session-current-tab')
          ? { left: 300, right: 500 }
          : { left: 0, right: 320 }
      ) as DOMRect
    }
  )
  const item = { key: 'a', title: 'Session' } as SessionListItem
  const renderTab = (selected: boolean) => (
    <div className="session-panel-tabs">
      <SessionPanelTab item={item} selected={selected} onActivate={vi.fn()} onClose={vi.fn()} />
    </div>
  )
  const view = render(renderTab(false))
  const strip = view.container.firstElementChild as HTMLElement
  strip.scrollTop = 25
  expect(strip.scrollLeft).toBe(0)
  view.rerender(renderTab(true))
  expect(strip.scrollLeft).toBe(180)
  expect(strip.scrollTop).toBe(25)
})
