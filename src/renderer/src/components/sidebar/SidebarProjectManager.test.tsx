// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  state: {
    activeView: 'terminal',
    activeWorkspaceExecutionHostId: 'local',
    activeWorkspaceKey: 'worktree:main',
    sidebarBody: 'workspaces',
    openModal: vi.fn()
  }
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('./SidebarHeader', () => ({ default: () => null }))
vi.mock('./WorktreeList', () => ({
  default: ({ onWorkspaceActivated }: { onWorkspaceActivated: () => void }) => (
    <>
      <button onClick={onWorkspaceActivated}>Open current workspace</button>
      <button>Selection only</button>
    </>
  )
}))
import SidebarProjectManager from './SidebarProjectManager'
const props = { scrollOffsetRef: { current: 0 }, scrollAnchorRef: { current: null } }
beforeEach(() => {
  mocks.state.sidebarBody = 'workspaces'
})
afterEach(cleanup)
it('closes after explicit activation even when the location is unchanged, but not selection-only', () => {
  render(<SidebarProjectManager {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Manage projects' }))
  fireEvent.click(screen.getByRole('button', { name: 'Selection only' }))
  expect(screen.queryByRole('dialog')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open current workspace' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('closes when switching to the activity sidebar', () => {
  const view = render(<SidebarProjectManager {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Manage projects' }))
  mocks.state.sidebarBody = 'agents'
  view.rerender(<SidebarProjectManager {...props} />)
  expect(screen.queryByRole('dialog')).toBeNull()
})
