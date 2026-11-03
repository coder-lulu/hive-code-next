import { describe, expect, it, vi } from 'vitest'
import { toggleAgentDashboardFromShortcut } from './ipc-events/agent-dashboard-command'

type DashboardState = Parameters<typeof toggleAgentDashboardFromShortcut>[0]

function makeState(overrides: Partial<DashboardState> = {}) {
  return {
    activeView: 'terminal' as const,
    workspaceBoardOpen: false,
    workspaceBoardView: 'workspaces' as const,
    setSidebarOpen: vi.fn(),
    setWorkspaceBoardOpen: vi.fn(),
    setWorkspaceBoardView: vi.fn(),
    ...overrides
  } satisfies DashboardState
}

describe('toggleAgentDashboardFromShortcut', () => {
  it('opens the agents board with no opt-in setting', () => {
    const state = makeState()
    toggleAgentDashboardFromShortcut(state)
    expect(state.setSidebarOpen).toHaveBeenCalledWith(true)
    expect(state.setWorkspaceBoardView).toHaveBeenCalledWith('agents')
    expect(state.setWorkspaceBoardOpen).toHaveBeenCalledWith(true)
  })

  it('keeps Settings visible', () => {
    const state = makeState({ activeView: 'settings' })
    toggleAgentDashboardFromShortcut(state)
    expect(state.setSidebarOpen).not.toHaveBeenCalled()
    expect(state.setWorkspaceBoardOpen).not.toHaveBeenCalled()
    expect(state.setWorkspaceBoardView).not.toHaveBeenCalled()
  })

  it('switches an open workspaces board to agents', () => {
    const state = makeState({ workspaceBoardOpen: true })
    toggleAgentDashboardFromShortcut(state)
    expect(state.setWorkspaceBoardView).toHaveBeenCalledWith('agents')
    expect(state.setWorkspaceBoardOpen).toHaveBeenCalledWith(true)
  })

  it('closes the agents board without reopening a collapsed sidebar', () => {
    const state = makeState({ workspaceBoardOpen: true, workspaceBoardView: 'agents' })
    toggleAgentDashboardFromShortcut(state)
    expect(state.setWorkspaceBoardOpen).toHaveBeenCalledWith(false)
    expect(state.setSidebarOpen).not.toHaveBeenCalled()
    expect(state.setWorkspaceBoardView).not.toHaveBeenCalled()
  })
})
