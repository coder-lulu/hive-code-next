// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'

const mocks = vi.hoisted(() => {
  const state = {
    runtimeStatusByEnvironmentId: new Map(),
    repos: [] as { id: string; displayName: string; path: string }[],
    worktreesByRepo: {} as Record<string, unknown[]>,
    tabsByWorktree: {} as Record<string, unknown[]>,
    unifiedTabsByWorktree: {} as Record<string, unknown[]>,
    openFiles: [] as unknown[],
    projectGroups: [] as unknown[],
    folderWorkspaces: [] as unknown[],
    projects: [] as { id: string; displayName: string; sourceRepoIds: string[] }[],
    projectHostSetups: [] as unknown[],
    activeWorkspaceKey: null,
    activeWorktreeId: null,
    activeRepoId: null,
    activeWorkspaceExecutionHostId: null,
    collapsedGroups: new Set<string>(),
    homeTaskDraft: 'implement the permission flow',
    homeReturnScope: null,
    homeNewTaskMode: false,
    homeComposerFocusRequest: 0,
    settings: {
      defaultTuiAgent: 'codex' as const,
      disabledTuiAgents: [] as string[]
    },
    setHomeTaskDraft: vi.fn(),
    restoreHomeReturnScope: vi.fn(),
    exitNewTaskHome: vi.fn(),
    updateSettings: vi.fn(),
    openSettingsPage: vi.fn(),
    openSettingsTarget: vi.fn(),
    openModal: vi.fn(),
    openSessionsPage: vi.fn(),
    updateSessionsView: vi.fn()
  }
  const useAppStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state }
  )
  return {
    state,
    isWebClient: false,
    useAppStore,
    launchAgentInNewTab: vi.fn(),
    newAgentLaunchRequestId: vi.fn(() => 'home-request'),
    activateAndRevealWorkspace: vi.fn(() => true),
    activateTemporarySessionInMain: vi.fn(),
    createSessionLaunchTracker: vi.fn(() => ({
      markLaunched: vi.fn(() => false),
      stop: vi.fn()
    }))
  }
})

vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => mocks.isWebClient }))

vi.mock('../store', () => ({ useAppStore: mocks.useAppStore }))
vi.mock('@/hooks/useAgentDetectionTarget', () => ({
  useAgentDetectionTargetForWorktree: vi.fn(() => ({ kind: 'local' }))
}))
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: vi.fn(() => ({ detectedIds: new Set(['codex']) }))
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: mocks.launchAgentInNewTab
}))
vi.mock('@/lib/agent-launch-request-id', () => ({
  newAgentLaunchRequestId: mocks.newAgentLaunchRequestId
}))
vi.mock('@/lib/temporary-session-navigation', () => ({
  activateTemporarySessionInMain: mocks.activateTemporarySessionInMain
}))
vi.mock('./sessions/session-launch-tracker', () => ({
  createSessionLaunchTracker: mocks.createSessionLaunchTracker
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: mocks.activateAndRevealWorkspace
}))
vi.mock('./landing/DesktopHomeComposerFooter', () => ({
  DesktopHomeComposerFooter: (props: {
    model: { projects: { identityKey: string }[]; workspaces: { identityKey: string }[] }
    onWorkspaceChange: (value: string) => void
    onPermissionChange: (value: 'manual' | 'yolo') => void
    onSubmit: () => void
  }) => (
    <div>
      <button type="button" onClick={() => props.onPermissionChange('manual')}>
        manual
      </button>
      <button type="button" onClick={() => props.onPermissionChange('yolo')}>
        yolo
      </button>
      {props.model.projects[0] ? (
        <button
          type="button"
          onClick={() =>
            props.onWorkspaceChange(`project:${props.model.projects[0]?.identityKey ?? ''}`)
          }
        >
          select project
        </button>
      ) : null}
      {props.model.workspaces[0] ? (
        <button
          type="button"
          onClick={() => props.onWorkspaceChange(props.model.workspaces[0].identityKey)}
        >
          select workspace
        </button>
      ) : null}
      <button type="button" onClick={props.onSubmit}>
        submit
      </button>
    </div>
  )
}))

import Landing from './Landing'

describe('Landing permission mode wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isWebClient = false
    mocks.state.runtimeStatusByEnvironmentId.clear()
    mocks.state.repos = []
    mocks.state.worktreesByRepo = {}
    mocks.state.projects = []
    mocks.state.homeTaskDraft = 'implement the permission flow'
    mocks.launchAgentInNewTab.mockReturnValue({ tabId: 'floating-agent-tab' })
    mocks.activateTemporarySessionInMain.mockReturnValue(true)
    mocks.activateAndRevealWorkspace.mockReturnValue(true)
  })

  afterEach(cleanup)

  it('requires a Host workspace on Web and retains the draft for both submit paths', () => {
    mocks.isWebClient = true
    render(<Landing />)
    expect(screen.getByRole('status').textContent).toContain('Select a connected Host workspace')
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
    expect(mocks.newAgentLaunchRequestId).not.toHaveBeenCalled()
    expect(mocks.createSessionLaunchTracker).not.toHaveBeenCalled()
    expect(mocks.state.setHomeTaskDraft).not.toHaveBeenCalled()
  })

  it('keeps Host guidance below the composer and describes the draft accessibly', () => {
    mocks.isWebClient = true
    const { rerender } = render(<Landing />)
    const guidance = screen.getByRole('status')
    const composer = screen.getByRole('region', { name: 'New task' })
    const draft = screen.getByRole('textbox', { name: 'Task description' })

    expect(composer.contains(guidance)).toBe(false)
    expect(guidance.id).not.toBe('')
    expect(draft.getAttribute('aria-describedby')).toBe(guidance.id)
    expect(composer.compareDocumentPosition(guidance) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0
    )

    mocks.isWebClient = false
    rerender(<Landing />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(draft.hasAttribute('aria-describedby')).toBe(false)
  })

  it('does not render a Spaces project card beneath the composer', () => {
    render(<Landing />)

    expect(document.querySelector('.desktop-home-card-wide')).toBeNull()
  })

  it('passes the selected mode into a direct agent launch', () => {
    render(<Landing />)

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'codex',
        agentPermissionMode: 'manual',
        requestId: 'home-request',
        launchSource: 'desktop_home'
      })
    )
    expect(mocks.newAgentLaunchRequestId).toHaveBeenCalledOnce()
  })
  it.each([true, false])(
    'mints a workspace launch request only after activation succeeds: %s',
    (activated) => {
      mocks.state.repos = [{ id: 'repo-1', displayName: 'Project', path: '/project' }]
      mocks.state.worktreesByRepo = { 'repo-1': [makeWorktree({ id: 'wt-1', repoId: 'repo-1' })] }
      mocks.activateAndRevealWorkspace.mockReturnValue(activated)
      render(<Landing />)
      fireEvent.click(screen.getByRole('button', { name: 'select workspace' }))
      fireEvent.click(screen.getByRole('button', { name: 'submit' }))
      expect(mocks.activateAndRevealWorkspace).toHaveBeenCalledWith('wt-1', {
        providesInitialSurface: true,
        executionHostId: 'local'
      })
      if (activated) {
        expect(mocks.newAgentLaunchRequestId).toHaveBeenCalledOnce()
        expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
          expect.objectContaining({
            requestId: 'home-request',
            worktreeId: 'wt-1',
            executionHostId: 'local',
            launchSource: 'desktop_home'
          })
        )
      } else {
        expect(mocks.newAgentLaunchRequestId).not.toHaveBeenCalled()
        expect(mocks.launchAgentInNewTab).not.toHaveBeenCalled()
      }
    }
  )

  it('opens the sessions page after a temporary session receives its inventory key', () => {
    render(<Landing />)

    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    const [[options]] = mocks.createSessionLaunchTracker.mock.calls as unknown as [
      [{ onMatch: (item: { key: string }) => void }]
    ]

    act(() => options.onMatch({ key: 'global-floating-terminal|floating-agent-tab' }))

    expect(mocks.state.openSessionsPage).toHaveBeenCalledWith({ kind: 'all' })
    expect(mocks.state.updateSessionsView).toHaveBeenCalledWith(
      expect.objectContaining({
        navigation: 'sessions',
        selectedSessionKey: 'global-floating-terminal|floating-agent-tab'
      })
    )
  })

  it('passes the selected mode into the first-workspace composer', () => {
    mocks.state.repos = [{ id: 'repo-1', displayName: 'Project', path: '/project' }]
    mocks.state.worktreesByRepo = { 'repo-1': [] }
    mocks.state.projects = [{ id: 'project-1', displayName: 'Project', sourceRepoIds: ['repo-1'] }]
    render(<Landing />)

    fireEvent.click(screen.getByRole('button', { name: 'yolo' }))
    fireEvent.click(screen.getByRole('button', { name: 'select project' }))
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    expect(mocks.state.openModal).toHaveBeenCalledWith(
      'new-workspace-composer',
      expect.objectContaining({
        initialRepoId: 'repo-1',
        initialPrompt: 'implement the permission flow',
        initialAgent: 'codex',
        initialAgentPermissionMode: 'yolo'
      })
    )
  })
})
