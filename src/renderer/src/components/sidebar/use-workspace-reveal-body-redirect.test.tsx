// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  SCROLL_TO_CURRENT_WORKSPACE_REVEAL_REQUEST_EVENT as REQUEST,
  WORKSPACE_REVEAL_LIST_READY_EVENT as READY
} from '@/lib/scroll-to-current-workspace-status'
const mocks = vi.hoisted(() => ({
  state: {
    activeView: 'terminal',
    activeWorktreeId: 'wt',
    sessionsView: { navigation: 'sessions' },
    updateSessionsView: vi.fn(),
    openSessionsPage: vi.fn()
  }
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
import { useWorkspaceRevealBodyRedirect } from './use-workspace-reveal-body-redirect'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.activeView = 'terminal'
  mocks.state.sessionsView.navigation = 'sessions'
  mocks.state.updateSessionsView.mockImplementation((patch) =>
    Object.assign(mocks.state.sessionsView, patch)
  )
  mocks.state.openSessionsPage.mockImplementation(() => {
    mocks.state.activeView = 'sessions'
  })
})
afterEach(cleanup)
it('keeps the active workbench and waits for lazy tree readiness before replaying rename', () => {
  renderHook(() => useWorkspaceRevealBodyRedirect())
  const detail = { target: { type: 'active-workspace' }, beginRename: true }
  act(() => {
    window.dispatchEvent(new CustomEvent(REQUEST, { detail }))
  })
  expect(mocks.state.updateSessionsView).toHaveBeenCalledWith({ navigation: 'projects' })
  expect(mocks.state.openSessionsPage).not.toHaveBeenCalled()
  const listener = vi.fn()
  window.addEventListener(REQUEST, listener)
  expect(listener).not.toHaveBeenCalled()
  act(() => {
    window.dispatchEvent(new Event(READY))
    window.dispatchEvent(new Event(READY))
  })
  window.removeEventListener(REQUEST, listener)
  expect(listener).toHaveBeenCalledTimes(1)
  expect(listener.mock.calls[0][0].detail).toEqual(detail)
})
it('opens project management from a page without a tree', () => {
  mocks.state.activeView = 'settings'
  renderHook(() => useWorkspaceRevealBodyRedirect())
  act(() => {
    window.dispatchEvent(new CustomEvent(REQUEST))
  })
  expect(mocks.state.openSessionsPage).toHaveBeenCalledOnce()
})
it('does not redirect an already visible project tree', () => {
  mocks.state.sessionsView.navigation = 'projects'
  renderHook(() => useWorkspaceRevealBodyRedirect())
  act(() => {
    window.dispatchEvent(new CustomEvent(REQUEST))
  })
  expect(mocks.state.updateSessionsView).not.toHaveBeenCalled()
})
