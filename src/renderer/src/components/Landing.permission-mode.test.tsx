// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
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
    openModal: vi.fn()
  }
  const useAppStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state }
  )
  return {
    state,
    useAppStore,
    launchAgentInNewTab: vi.fn(),
    activateTemporarySessionInMain: vi.fn()
  }
})

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
vi.mock('@/lib/temporary-session-navigation', () => ({
  activateTemporarySessionInMain: mocks.activateTemporarySessionInMain
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorkspace: vi.fn(() => true) }))
vi.mock('./landing/DesktopHomeComposerFooter', () => ({
  DesktopHomeComposerFooter: (props: {
    model: { projects: { identityKey: string }[] }
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
    mocks.state.repos = []
    mocks.state.worktreesByRepo = {}
    mocks.state.projects = []
    mocks.state.homeTaskDraft = 'implement the permission flow'
    mocks.launchAgentInNewTab.mockReturnValue({ tabId: 'floating-agent-tab' })
    mocks.activateTemporarySessionInMain.mockReturnValue(true)
  })

  afterEach(cleanup)

  it('does not render a Spaces project card beneath the composer', () => {
    render(<Landing />)

    expect(document.querySelector('.desktop-home-card-wide')).toBeNull()
  })

  it('passes the selected mode into a direct agent launch', () => {
    render(<Landing />)

    fireEvent.click(screen.getByRole('button', { name: 'manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'codex', agentPermissionMode: 'manual' })
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
