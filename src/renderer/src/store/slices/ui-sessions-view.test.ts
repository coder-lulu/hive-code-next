import { createStore } from 'zustand/vanilla'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../types'
import { createUiViewActions } from './ui/ui-slice-view-actions'
import { createWorktreeNavHistorySlice, setWorktreeNavViewActivator } from './worktree-nav-history'
import { applyWorktreeNavViewEntry } from '@/lib/worktree-nav-view-history-replay'

const mocks = vi.hoisted(() => ({ getState: vi.fn(), setState: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: mocks }))

function createViewStore() {
  const store = createStore<AppState>()(
    (set, get, api) =>
      ({
        activeView: 'terminal',
        setActiveView: (view) => set({ activeView: view }),
        worktreesByRepo: {},
        folderWorkspaces: [],
        ...createWorktreeNavHistorySlice(set, get, api),
        ...createUiViewActions(set, get)
      }) as unknown as AppState
  )
  mocks.getState.mockImplementation(store.getState)
  mocks.setState.mockImplementation(store.setState)
  return store
}

afterEach(() => setWorktreeNavViewActivator(null))

describe('sessions page navigation memory', () => {
  it('keeps project hierarchy navigation when selecting or creating a workspace on another host', () => {
    const store = createViewStore()
    store.getState().updateSessionsView({ navigation: 'projects' })
    store.getState().updateSessionsView({
      scope: { kind: 'workspace', workspaceKey: 'one', executionHostId: 'local' }
    })
    expect(store.getState().sessionsView.navigation).toBe('projects')
    store
      .getState()
      .openSessionsPage({ kind: 'workspace', workspaceKey: 'two', executionHostId: 'ssh:other' })
    expect(store.getState().sessionsView.navigation).toBe('projects')
    expect(store.getState().sessionsView.selectedSessionKey).toBeNull()
  })
  it('keeps scope, search, selection and scroll when leaving and returning', () => {
    const store = createViewStore()
    store.getState().openSessionsPage({ kind: 'project', projectKey: 'project-1' })
    store.getState().updateSessionsView({
      query: 'deploy',
      selectedSessionKey: 'host-a:session-1',
      scrollTop: 280
    })
    const saved = store.getState().sessionsView
    store.getState().openSkillsPage()
    store.getState().openSessionsPage()
    expect(store.getState().activeView).toBe('sessions')
    expect(store.getState().sessionsView).toBe(saved)
    expect(store.getState().worktreeNavHistory).toEqual(['sessions', 'skills', 'sessions'])
  })

  it('preserves navigation memory when an equivalent scope is selected again', () => {
    const store = createViewStore()
    store
      .getState()
      .openSessionsPage({ kind: 'workspace', workspaceKey: 'folder:one', executionHostId: 'local' })
    store.getState().updateSessionsView({ query: 'test', selectedSessionKey: 'one', scrollTop: 56 })
    const saved = store.getState().sessionsView
    store
      .getState()
      .openSessionsPage({ kind: 'workspace', workspaceKey: 'folder:one', executionHostId: 'local' })
    expect(store.getState().sessionsView).toBe(saved)
    expect(store.getState().worktreeNavHistory).toEqual(['sessions'])
  })

  it('resets navigation memory when the same workspace key belongs to another host', () => {
    const store = createViewStore()
    store
      .getState()
      .openSessionsPage({ kind: 'workspace', workspaceKey: 'shared', executionHostId: 'local' })
    store
      .getState()
      .updateSessionsView({ query: 'old', selectedSessionKey: 'local:one', scrollTop: 56 })
    store
      .getState()
      .openSessionsPage({ kind: 'workspace', workspaceKey: 'shared', executionHostId: 'ssh:other' })
    expect(store.getState().sessionsView).toEqual({
      scope: { kind: 'workspace', workspaceKey: 'shared', executionHostId: 'ssh:other' },
      query: '',
      selectedSessionKey: null,
      scrollTop: 0
    })
  })

  it('resets stale filters on a scope patch and allows an explicit target in the new scope', () => {
    const store = createViewStore()
    store.getState().updateSessionsView({ query: 'old', selectedSessionKey: 'old', scrollTop: 280 })
    store.getState().updateSessionsView({
      scope: { kind: 'unassigned' },
      selectedSessionKey: 'new'
    })
    expect(store.getState().sessionsView).toEqual({
      scope: { kind: 'unassigned' },
      query: '',
      selectedSessionKey: 'new',
      scrollTop: 0
    })
  })

  it('resets query and selection when opening another project', () => {
    const store = createViewStore()
    store.getState().openSessionsPage({ kind: 'project', projectKey: 'one' })
    store
      .getState()
      .updateSessionsView({ query: 'deploy', selectedSessionKey: 'one', scrollTop: 56 })
    store.getState().openSessionsPage({ kind: 'project', projectKey: 'two' })
    expect(store.getState().sessionsView).toEqual({
      scope: { kind: 'project', projectKey: 'two' },
      query: '',
      selectedSessionKey: null,
      scrollTop: 0
    })
  })

  it('replays sessions through back/forward history without clearing the current selection', () => {
    const store = createViewStore()
    setWorktreeNavViewActivator(applyWorktreeNavViewEntry)
    store.getState().openSessionsPage()
    store
      .getState()
      .updateSessionsView({ query: 'work', selectedSessionKey: 'session-2', scrollTop: 112 })
    const saved = store.getState().sessionsView
    store.getState().openSkillsPage()
    store.getState().goBackWorktree()
    expect(store.getState().activeView).toBe('sessions')
    expect(store.getState().sessionsView).toBe(saved)
    store.getState().goForwardWorktree()
    expect(store.getState().activeView).toBe('skills')
    expect(store.getState().worktreeNavHistory).toEqual(['sessions', 'skills'])
    expect(store.getState().sessionsView).toBe(saved)
  })
})
