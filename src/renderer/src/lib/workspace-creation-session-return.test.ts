import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import type { SessionListItem } from '@/components/sessions/session-list-types'
import {
  returnCreatedWorkspaceToSessions,
  selectCreatedWorkspaceSession
} from './workspace-creation-session-return'

const ownerHost = vi.hoisted(() => vi.fn(() => null as string | null))
vi.mock('./resolved-worktree-execution-host', () => ({
  getResolvedExecutionHostIdForWorktree: ownerHost
}))
beforeEach(() => ownerHost.mockReset())

vi.mock('@/store', () => ({ useAppStore: { getState: vi.fn() } }))
vi.mock('@/components/sessions/use-session-collection', () => ({
  createSessionCollectionSelector: () => () => ({ items: [] })
}))

function item(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    key: 'remote-session',
    ownerBucketKey: 'wt',
    executionHostId: 'ssh:remote',
    unifiedTabId: 'unified',
    terminalTabId: 'terminal',
    ...overrides
  } as SessionListItem
}

describe('created workspace session return', () => {
  it('selects the exact host even when terminal and workspace ids collide', () => {
    expect(
      selectCreatedWorkspaceSession(
        [item({ key: 'local-session', executionHostId: 'local' }), item()],
        'wt',
        'ssh:remote',
        'unified',
        'terminal'
      )
    ).toBe('remote-session')
  })

  it('selects a structured session using the active unified tab', () => {
    expect(
      selectCreatedWorkspaceSession(
        [item({ kind: 'structured', terminalTabId: null })],
        'wt',
        'ssh:remote',
        'unified',
        null
      )
    ).toBe('remote-session')
  })

  it('does not substitute another session when the active tab is absent or ambiguous', () => {
    expect(
      selectCreatedWorkspaceSession([item()], 'wt', 'ssh:remote', 'browser', 'terminal')
    ).toBeNull()
    expect(
      selectCreatedWorkspaceSession(
        [item(), item({ key: 'duplicate' })],
        'wt',
        'ssh:remote',
        'unified',
        null
      )
    ).toBeNull()
  })

  it('returns an empty workspace scope when no session is available', () => {
    const openSessionsPage = vi.fn()
    const updateSessionsView = vi.fn()
    const state = {
      activeWorktreeId: 'wt',
      activeWorkspaceExecutionHostId: 'ssh:remote',
      groupsByWorktree: {},
      activeGroupIdByWorktree: {},
      activeTabIdByWorktree: {},
      openSessionsPage,
      updateSessionsView
    } as unknown as AppState
    expect(returnCreatedWorkspaceToSessions('wt', state)).toBe(true)
    expect(openSessionsPage).toHaveBeenCalledWith({
      kind: 'workspace',
      workspaceKey: 'wt',
      executionHostId: 'ssh:remote'
    })
    expect(updateSessionsView).toHaveBeenCalledWith({
      selectedSessionKey: null,
      query: '',
      scrollTop: 0
    })
  })

  it('resolves the hydrated owner when legacy activation leaves its host null', () => {
    ownerHost.mockReturnValue('local')
    const state = {
      activeWorktreeId: 'wt',
      activeWorkspaceExecutionHostId: null,
      groupsByWorktree: {},
      activeGroupIdByWorktree: {},
      activeTabIdByWorktree: {},
      openSessionsPage: vi.fn(),
      updateSessionsView: vi.fn()
    } as unknown as AppState
    expect(returnCreatedWorkspaceToSessions('wt', state)).toBe(true)
    expect(state.openSessionsPage).toHaveBeenCalledWith({
      kind: 'workspace',
      workspaceKey: 'wt',
      executionHostId: 'local'
    })
    expect(ownerHost).toHaveBeenCalledWith(state, 'wt')
  })

  it('does not navigate using the previous owner or a missing host', () => {
    const openSessionsPage = vi.fn()
    const state = {
      activeWorktreeId: 'old',
      activeWorkspaceExecutionHostId: 'local',
      openSessionsPage
    } as unknown as AppState
    expect(returnCreatedWorkspaceToSessions('new', state)).toBe(false)
    expect(
      returnCreatedWorkspaceToSessions('old', { ...state, activeWorkspaceExecutionHostId: null })
    ).toBe(false)
    expect(openSessionsPage).not.toHaveBeenCalled()
  })
})
