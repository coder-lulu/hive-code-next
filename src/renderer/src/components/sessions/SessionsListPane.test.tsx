// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SessionListItem } from './session-list-types'
import type { SessionListMetadata } from '../../../../shared/session-list-metadata'

const mocks = vi.hoisted(() => ({
  terminate: vi.fn(),
  error: vi.fn(),
  state: {
    sessionListMetadata: {} as SessionListMetadata,
    updateSessionListMetadata: vi.fn(),
    openNewTaskHome: vi.fn()
  }
}))
vi.mock('@/lib/temporary-session-actions', () => ({ deleteTemporarySession: mocks.terminate }))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, start: index * 56 })),
    getTotalSize: () => count * 56,
    measureElement: vi.fn(),
    scrollToOffset: vi.fn(),
    scrollToIndex: vi.fn()
  })
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/i18n/relative-time-format', () => ({ formatUiRelativeTime: () => 'now' }))
vi.mock('@/hooks/use-now', () => ({ useNow: () => 1000 }))
vi.mock('@/lib/agent-catalog', () => ({ getAgentCatalog: () => [], AgentIcon: () => null }))
vi.mock('./SessionCreationMenu', () => ({ default: () => <button>New session</button> }))
vi.mock('./SessionWorkspaceFilter', () => ({ default: () => null }))
vi.mock('./SessionScopePicker', () => ({ default: () => null }))
vi.mock('./SessionStatus', () => ({ default: () => null, SessionConnection: () => null }))
import SessionsListPane from './SessionsListPane'

const items = [
  { key: 'one', title: 'First session', kind: 'terminal', lastActivityAt: 1, hostLabel: 'Local' },
  { key: 'two', title: 'Second session', kind: 'terminal', lastActivityAt: 2, hostLabel: 'Local' }
] as SessionListItem[]
const updateView = vi.fn()
function pane(filtered = items) {
  return (
    <SessionsListPane
      items={filtered}
      allItems={items}
      projects={[]}
      view={{ scope: { kind: 'all' }, query: '', selectedSessionKey: 'one', scrollTop: 0 }}
      updateView={updateView}
    />
  )
}
afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mocks.state.sessionListMetadata = {}
  mocks.state.updateSessionListMetadata.mockImplementation((key: string, patch: object) => {
    mocks.state.sessionListMetadata = {
      ...mocks.state.sessionListMetadata,
      [key]: { ...mocks.state.sessionListMetadata[key], ...patch }
    }
  })
})
it('keeps row actions separate from opening and moves archived sessions into an expandable group', () => {
  const result = render(pane())
  expect(result.container.querySelector('button button')).toBeNull()
  fireEvent.click(screen.getAllByRole('button', { name: 'Archive session' })[0])
  expect(updateView).toHaveBeenCalledExactlyOnceWith({ selectedSessionKey: null })
  result.rerender(pane())
  expect(screen.queryByRole('option', { name: /First session/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Archived/ }))
  expect(screen.getByRole('option', { name: /First session/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Unarchive session' }))
  result.rerender(pane())
  expect(screen.queryByRole('button', { name: /Archived/ })).toBeNull()
  expect(screen.getAllByRole('option')).toHaveLength(2)
})
it('pins before other rows, remains reversible and never selects via the pin action', () => {
  const result = render(pane())
  fireEvent.click(screen.getAllByRole('button', { name: 'Pin session' })[1])
  result.rerender(pane())
  expect(screen.getAllByRole('option')[0].textContent).toContain('Second session')
  expect(updateView).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Unpin session' }))
  result.rerender(pane())
  expect(screen.getAllByRole('option')[0].textContent).toContain('First session')
})
it('shows the archive group when the filtered view contains only archived sessions', () => {
  mocks.state.sessionListMetadata = { one: { archived: true } }
  render(pane([items[0]]))
  expect(screen.getByRole('button', { name: /Archived/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Archived/ }))
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(screen.queryByText('Second session')).toBeNull()
})

it('offers termination only after archiving and passes the exact owner without hiding the row optimistically', async () => {
  const item = {
    ...items[0],
    ownerBucketKey: 'folder:one',
    executionHostId: 'local' as const,
    terminalTabId: 'terminal',
    unifiedTabId: 'unified'
  }
  const view = render(pane([item]))
  expect(screen.queryByRole('button', { name: 'Terminate session' })).toBeNull()
  mocks.state.sessionListMetadata = { one: { archived: true } }
  view.rerender(pane([item]))
  fireEvent.click(screen.getByRole('button', { name: /Archived/ }))
  mocks.terminate.mockResolvedValue(false)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Terminate session' }))
  })
  expect(mocks.terminate).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerBucketKey: 'folder:one',
      executionHostId: 'local',
      terminalTabId: 'terminal',
      unifiedTabId: 'unified'
    }),
    { allowWorkspaceOwner: true }
  )
  expect(mocks.error).toHaveBeenCalledOnce()
  expect(screen.getByRole('option', { name: /First session/ })).toBeTruthy()
  expect(updateView).not.toHaveBeenCalled()
})

it('resizes the sessions pane independently and restores its saved width', () => {
  localStorage.setItem('hive-projects-pane-width', '400')
  localStorage.removeItem('hive-sessions-pane-width')
  const result = render(pane())
  const handle = screen.getByRole('separator', { name: 'Resize sessions pane' })
  const container = screen.getByRole('complementary')
  expect(container.style.width).toBe('320px')
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(container.style.width).toBe('336px')
  fireEvent.keyDown(handle, { key: 'Home' })
  fireEvent.keyDown(handle, { key: 'ArrowLeft' })
  expect(container.style.width).toBe('240px')
  fireEvent.keyDown(handle, { key: 'End' })
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(container.style.width).toBe('520px')
  expect(localStorage.getItem('hive-projects-pane-width')).toBe('400')
  result.unmount()
  render(pane())
  expect(screen.getByRole('complementary').style.width).toBe('520px')
  fireEvent.doubleClick(screen.getByRole('separator', { name: 'Resize sessions pane' }))
  expect(screen.getByRole('complementary').style.width).toBe('320px')
  localStorage.removeItem('hive-projects-pane-width')
  localStorage.removeItem('hive-sessions-pane-width')
})

it('collapses without losing rows, selection or archive state and restores its width', () => {
  mocks.state.sessionListMetadata = { two: { archived: true } }
  const result = render(pane())
  const container = screen.getByRole('complementary')
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
  fireEvent.click(screen.getByRole('button', { name: /Archived/ }))
  const row = screen.getByRole('option', { name: /First session/ })
  const collapse = screen.getByRole('button', { name: 'Collapse sessions pane' })
  collapse.focus()
  fireEvent.click(collapse)
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(screen.queryByRole('separator')).toBeNull()
  expect(row.isConnected).toBe(true)
  expect(row.getAttribute('aria-selected')).toBe('true')
  const expand = screen.getByRole('button', { name: 'Expand sessions pane' })
  expect(document.activeElement).toBe(expand)
  expect(expand.getAttribute('aria-expanded')).toBe('false')
  expect(document.getElementById(expand.getAttribute('aria-controls')!)?.hidden).toBe(true)
  expect(localStorage.getItem('hive-sessions-pane-width')).toBe('336')
  expect(updateView).not.toHaveBeenCalled()
  fireEvent.click(expand)
  expect(container.style.width).toBe('336px')
  expect(screen.getByRole('option', { name: /First session/ })).toBe(row)
  expect(screen.getByRole('option', { name: /Second session/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Archived/ }).getAttribute('aria-expanded')).toBe(
    'true'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Collapse sessions pane' }))
  result.unmount()
  render(pane())
  expect(screen.getByRole('button', { name: 'Expand sessions pane' })).toBeTruthy()
  expect(screen.queryByRole('listbox')).toBeNull()
})
