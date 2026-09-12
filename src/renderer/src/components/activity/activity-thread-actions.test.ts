import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { makeRepo, makeTab, makeWorktree } from './ActivityPrototypePage-test-fixtures'
import type { AgentPaneThread } from './activity-thread-types'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  focusPane: vi.fn(),
  structured: vi.fn(),
  activateAndRevealWorkspace: vi.fn(),
  openActivityPage: vi.fn(),
  openSessionsPage: vi.fn(),
  updateSessionsView: vi.fn()
}))

vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: mocks.focusPane }))
vi.mock('@/lib/structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionTab: mocks.structured
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: mocks.activateAndRevealWorkspace
}))

import { createActivityThreadActions, hasActivityThreadWorkspace } from './activity-thread-actions'

const REMOTE_HOST = 'ssh:devbox' as const

function makeRemoteThread(): AgentPaneThread {
  const worktree = { ...makeWorktree(), hostId: REMOTE_HOST }
  return {
    paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
    paneTitle: 'Remote agent',
    agentType: 'claude',
    worktree,
    repo: makeRepo(),
    tab: makeTab(),
    events: [],
    latestEvent: null,
    latestTimestamp: 1_000,
    currentAgentState: 'working',
    currentAgentEntry: null,
    unread: true,
    responsePreview: ''
  }
}

describe('activity thread destination routing', () => {
  const thread = makeRemoteThread()
  const getKnownWorktreeById = vi.fn()
  const setActiveWorktree = vi.fn()
  const acknowledgeAgents = vi.fn()
  const setSelectedPaneKey = vi.fn()
  let state: Record<string, unknown>

  function makeActions(): ReturnType<typeof createActivityThreadActions> {
    return createActivityThreadActions({
      getMarkAllReadThreads: () => [thread],
      acknowledgeAgents,
      unacknowledgeAgents: vi.fn(),
      setSelectedPaneKey
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.structured.mockReturnValue(false)
    mocks.activateAndRevealWorkspace.mockReturnValue({ primaryTabId: null })
    getKnownWorktreeById.mockReturnValue(thread.worktree)
    state = {
      getKnownWorktreeById,
      worktreesByRepo: { [thread.worktree.repoId]: [thread.worktree] },
      detectedWorktreesByRepo: {},
      folderWorkspaces: [],
      projects: [],
      projectHostSetups: [],
      showSleepingWorkspaces: true,
      filterRepoIds: [],
      hideDefaultBranchWorkspace: false,
      hideAutomationGeneratedWorkspaces: false,
      hideCliCreatedWorkspaces: false,
      hideDetachedHeadWorkspaces: false,
      hideWorkspacesFromOtherDevices: false,
      alwaysShowDefaultBranchWorkspace: true,
      visibleWorkspaceHostIds: null,
      workspaceHostScope: 'all',
      tabsByWorktree: { [thread.worktree.id]: [thread.tab] },
      unifiedTabsByWorktree: {},
      activeRepoId: thread.worktree.repoId,
      activeWorktreeId: thread.worktree.id,
      activeWorkspaceExecutionHostId: 'local',
      setActiveRepo: vi.fn(),
      setActiveWorktree,
      setActiveTabType: vi.fn()
    }
    state.openActivityPage = mocks.openActivityPage
    state.openSessionsPage = mocks.openSessionsPage
    state.updateSessionsView = mocks.updateSessionsView
    mocks.getState.mockImplementation(() => state)
  })

  it('opens the existing project navigation and selects the project workspace', () => {
    makeActions().selectThread(thread)

    expect(mocks.openSessionsPage).toHaveBeenCalledWith()
    expect(mocks.updateSessionsView).toHaveBeenCalledWith({ navigation: 'projects', query: '' })
    expect(mocks.activateAndRevealWorkspace).toHaveBeenCalledWith(thread.worktree.id, {
      executionHostId: REMOTE_HOST
    })
    expect(mocks.focusPane).toHaveBeenCalledWith(
      thread.tab.id,
      '11111111-1111-4111-8111-111111111111',
      { flashFocusedPane: true, scrollToBottomIfOutputSinceLastView: true }
    )
    expect(acknowledgeAgents).toHaveBeenCalledWith([thread.paneKey])
  })

  it('opens the temporary session list for a floating thread', () => {
    const floatingThread: AgentPaneThread = {
      ...thread,
      worktree: {
        ...thread.worktree,
        id: FLOATING_TERMINAL_WORKTREE_ID,
        hostId: undefined,
        repoId: '__activity_standalone__'
      },
      repo: null
    }

    state.tabsByWorktree = {
      [FLOATING_TERMINAL_WORKTREE_ID]: [
        { ...thread.tab, worktreeId: FLOATING_TERMINAL_WORKTREE_ID }
      ]
    }
    state.unifiedTabsByWorktree = {
      [FLOATING_TERMINAL_WORKTREE_ID]: [
        {
          id: 'unified-tab',
          entityId: thread.tab.id,
          contentType: 'terminal',
          worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
          executionHostId: 'local'
        }
      ]
    }

    makeActions().selectThread(floatingThread)

    expect(mocks.openActivityPage).not.toHaveBeenCalled()
    expect(mocks.openSessionsPage).toHaveBeenCalledWith({ kind: 'all' })
    expect(mocks.activateAndRevealWorkspace).not.toHaveBeenCalled()
    expect(mocks.updateSessionsView).toHaveBeenCalledWith({
      navigation: 'sessions',
      query: '',
      scrollTop: 0,
      selectedSessionKey: `${FLOATING_TERMINAL_WORKTREE_ID}|unified-tab`
    })
  })

  it('selects the remote temporary session without selecting its local same-id twin', () => {
    const bucket = `runtime:remote|${FLOATING_TERMINAL_WORKTREE_ID}`
    state.tabsByWorktree = {
      [bucket]: [{ ...thread.tab, worktreeId: bucket }],
      [FLOATING_TERMINAL_WORKTREE_ID]: [
        { ...thread.tab, worktreeId: FLOATING_TERMINAL_WORKTREE_ID }
      ]
    }
    makeActions().selectThread({
      ...thread,
      repo: null,
      worktree: { ...thread.worktree, id: bucket, hostId: 'runtime:remote' }
    })
    expect(mocks.updateSessionsView).toHaveBeenCalledWith({
      navigation: 'sessions',
      query: '',
      scrollTop: 0,
      selectedSessionKey: `${bucket}|${thread.tab.id}`
    })
    expect(mocks.openActivityPage).not.toHaveBeenCalled()
  })

  it('does not focus another tab after failed project activation', () => {
    mocks.activateAndRevealWorkspace.mockReturnValueOnce(false)
    makeActions().selectThread(thread)
    expect(mocks.focusPane).not.toHaveBeenCalled()
    expect(mocks.structured).not.toHaveBeenCalled()
  })

  it('opens the existing project navigation without activating an unavailable workspace', () => {
    const unassignedThread: AgentPaneThread = { ...thread, repo: null }
    getKnownWorktreeById.mockReturnValue(undefined)
    state.worktreesByRepo = {}

    makeActions().selectThread(unassignedThread)

    expect(mocks.openSessionsPage).toHaveBeenCalledWith()
    expect(mocks.updateSessionsView).toHaveBeenCalledWith({ navigation: 'projects', query: '' })
    expect(mocks.activateAndRevealWorkspace).not.toHaveBeenCalled()
  })

  it('jumps to and probes the matching host-qualified workspace', () => {
    expect(hasActivityThreadWorkspace(thread)).toBe(true)

    makeActions().jumpToWorkspace(thread)

    expect(acknowledgeAgents).toHaveBeenCalledWith([thread.paneKey])
    expect(mocks.activateAndRevealWorkspace).toHaveBeenCalledWith(thread.worktree.id, {
      executionHostId: REMOTE_HOST
    })
  })

  it('marks all unread threads in the mark-all set, reading it at call time', () => {
    const readThread = { ...makeRemoteThread(), paneKey: 'tab-2:read', unread: false }
    let markAllSet = [readThread]
    const actions = createActivityThreadActions({
      getMarkAllReadThreads: () => markAllSet,
      acknowledgeAgents,
      unacknowledgeAgents: vi.fn(),
      setSelectedPaneKey
    })

    actions.markAllThreadsRead()
    expect(acknowledgeAgents).not.toHaveBeenCalled()

    // The handler keeps one identity while the set changes underneath it.
    markAllSet = [thread, readThread]
    actions.markAllThreadsRead()
    expect(acknowledgeAgents).toHaveBeenCalledWith([thread.paneKey])
  })
})
