import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '../types'
import { createUIStore } from './ui-slice-test-harness'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'

describe('desktop home new-task state', () => {
  it('opens the ordinary startup home while preserving restored workspace resources', () => {
    const store = createUIStore()
    const restoredTabs = [{ id: 'tab-1' }]
    const setActiveWorktree = vi.fn((worktreeId: string | null) => {
      store.setState({
        activeWorktreeId: worktreeId,
        activeWorkspaceKey: worktreeId ? `worktree:${worktreeId}` : null,
        activeWorkspaceExecutionHostId: null
      } as Partial<AppState>)
      return true
    })
    store.setState({
      activeView: 'settings',
      activeWorkspaceKey: 'worktree:wt-1',
      activeWorktreeId: 'wt-1',
      activeRepoId: 'repo-1',
      homeNewTaskMode: true,
      homeReturnScope: {
        scope: { type: 'worktree', worktreeId: 'wt-previous' },
        executionHostId: 'local',
        repoId: 'repo-previous'
      },
      homePendingSessionAssignment: {
        sessionId: 'session-1',
        tabId: 'tab-1',
        title: 'Restored task'
      },
      tabsByWorktree: { 'wt-1': restoredTabs },
      setActiveWorktree
    } as unknown as Partial<AppState>)

    store.getState().openStartupHome()

    expect(setActiveWorktree).toHaveBeenCalledWith(null)
    expect(store.getState().activeView).toBe('terminal')
    expect(store.getState().activeWorktreeId).toBeNull()
    expect(store.getState().activeWorkspaceKey).toBeNull()
    expect(store.getState().activeRepoId).toBeNull()
    expect(store.getState().homeNewTaskMode).toBe(false)
    expect(store.getState().homeReturnScope).toBeNull()
    expect(store.getState().homePendingSessionAssignment).toBeNull()
    expect(store.getState().tabsByWorktree['wt-1']).toBe(restoredTabs)
    expect(store.getState().homeComposerFocusRequest).toBe(0)
  })

  it('captures the scoped host and clears only the visual active context', () => {
    const store = createUIStore()
    const setActiveWorktree = vi.fn((worktreeId: string | null) => {
      store.setState({
        activeWorktreeId: worktreeId,
        activeWorkspaceKey: worktreeId ? `worktree:${worktreeId}` : null,
        activeWorkspaceExecutionHostId: null
      } as Partial<AppState>)
      return true
    })
    store.setState({
      activeWorkspaceKey: 'worktree:wt-1',
      activeWorktreeId: 'wt-1',
      activeRepoId: 'repo-1',
      activeWorkspaceExecutionHostId: 'runtime:cloud-1',
      setActiveWorktree
    } as unknown as Partial<AppState>)

    store.getState().openNewTaskHome()

    expect(setActiveWorktree).toHaveBeenCalledWith(null)
    expect(store.getState().activeWorktreeId).toBeNull()
    expect(store.getState().activeRepoId).toBeNull()
    expect(store.getState().homeNewTaskMode).toBe(true)
    expect(store.getState().homeReturnScope).toEqual({
      scope: { type: 'worktree', worktreeId: 'wt-1' },
      executionHostId: 'runtime:cloud-1',
      repoId: 'repo-1'
    })
    expect(store.getState().homeComposerFocusRequest).toBe(1)
  })

  it.each([
    [null, FLOATING_TERMINAL_WORKTREE_ID],
    [`worktree:${FLOATING_TERMINAL_WORKTREE_ID}`, FLOATING_TERMINAL_WORKTREE_ID],
    [null, `runtime:cloud-a|${FLOATING_TERMINAL_WORKTREE_ID}`],
    [
      `worktree:runtime:cloud-a|${FLOATING_TERMINAL_WORKTREE_ID}`,
      `runtime:cloud-a|${FLOATING_TERMINAL_WORKTREE_ID}`
    ]
  ])(
    'does not persist the floating terminal synthetic workspace as a return scope (%s)',
    (activeWorkspaceKey, activeWorktreeId) => {
      const store = createUIStore()
      const setActiveWorktree = vi.fn((worktreeId: string | null) => {
        store.setState({
          activeWorktreeId: worktreeId,
          activeWorkspaceKey: worktreeId ? `worktree:${worktreeId}` : null
        } as Partial<AppState>)
        return true
      })
      store.setState({
        activeWorkspaceKey,
        activeWorktreeId,
        activeRepoId: 'repo-should-not-return',
        setActiveWorktree
      } as unknown as Partial<AppState>)

      store.getState().openNewTaskHome()

      expect(setActiveWorktree).toHaveBeenCalledWith(null)
      expect(store.getState().homeReturnScope).toBeNull()
      expect(store.getState().activeRepoId).toBeNull()
      expect(store.getState().homeNewTaskMode).toBe(true)
    }
  )

  it('clears a stale return scope when a new task starts from standalone home context', () => {
    const store = createUIStore()
    store.setState({
      homeNewTaskMode: false,
      homeReturnScope: {
        scope: { type: 'worktree', worktreeId: 'stale-worktree' },
        executionHostId: 'local',
        repoId: 'stale-repo'
      },
      activeWorkspaceKey: null,
      activeWorktreeId: null,
      activeRepoId: null
    } as Partial<AppState>)

    store.getState().openNewTaskHome()

    expect(store.getState().homeReturnScope).toBeNull()
    expect(store.getState().homeNewTaskMode).toBe(true)
  })

  it('restores a folder scope with its host and clears the return snapshot', () => {
    const store = createUIStore()
    const setActiveFolderWorkspace = vi.fn((folderWorkspaceId: string, host?: string) => {
      store.setState({
        activeWorkspaceKey: `folder:${folderWorkspaceId}`,
        activeWorktreeId: `folder:${folderWorkspaceId}`,
        activeWorkspaceExecutionHostId: host ?? null
      } as Partial<AppState>)
    })
    store.setState({
      folderWorkspaces: [
        {
          id: 'folder-1',
          projectGroupId: 'group-1',
          name: 'Folder',
          folderPath: '/folder',
          linkedTask: null,
          comment: '',
          isArchived: false,
          isUnread: false,
          isPinned: false,
          sortOrder: 0,
          lastActivityAt: 0,
          createdAt: 0,
          updatedAt: 0
        }
      ],
      homeNewTaskMode: true,
      homeReturnScope: {
        scope: { type: 'folder', folderWorkspaceId: 'folder-1' },
        executionHostId: 'ssh:dev-box',
        repoId: null
      },
      setActiveFolderWorkspace
    } as unknown as Partial<AppState>)

    expect(store.getState().restoreHomeReturnScope()).toBe(true)
    expect(setActiveFolderWorkspace).toHaveBeenCalledWith('folder-1', 'ssh:dev-box')
    expect(store.getState().homeNewTaskMode).toBe(false)
    expect(store.getState().homeReturnScope).toBeNull()
  })

  it('clears a stale pending session assignment on ordinary new-task and exit transitions', () => {
    const store = createUIStore()
    const pending = {
      sessionId: 'session-1',
      tabId: 'tab-1',
      title: 'Temporary task'
    }

    store.setState({ activeWorkspaceKey: null, activeWorktreeId: null } as Partial<AppState>)
    store.getState().setHomePendingSessionAssignment(pending)
    store.getState().openNewTaskHome()
    expect(store.getState().homePendingSessionAssignment).toBeNull()

    store.getState().setHomePendingSessionAssignment(pending)
    store.getState().exitNewTaskHome()
    expect(store.getState().homePendingSessionAssignment).toBeNull()
  })
})
