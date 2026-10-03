import { describe, expect, it, vi } from 'vitest'
import { toggleAgentDashboardFromShortcut } from './agent-dashboard-command'

function state(open = false, view = 'workspaces') {
  return {
    activeView: 'terminal',
    workspaceBoardOpen: open,
    workspaceBoardView: view,
    setSidebarOpen: vi.fn(),
    setWorkspaceBoardOpen: vi.fn(),
    setWorkspaceBoardView: vi.fn()
  }
}

describe('unified board shortcut navigation', () => {
  it('leaves settings navigation unchanged', () => {
    const app = { ...state(), activeView: 'settings' }
    toggleAgentDashboardFromShortcut(app as never)
    expect(app.setWorkspaceBoardOpen).not.toHaveBeenCalled()
  })
  it('opens the agent view without an experimental setting', () => {
    const app = state()
    toggleAgentDashboardFromShortcut(app as never)
    expect(app.setWorkspaceBoardView).toHaveBeenCalledWith('agents')
    expect(app.setWorkspaceBoardOpen).toHaveBeenCalledWith(true)
    expect(app.setSidebarOpen).toHaveBeenCalledWith(true)
  })

  it('switches an open workspace board to agents without closing it', () => {
    const app = state(true)
    toggleAgentDashboardFromShortcut(app as never)
    expect(app.setWorkspaceBoardView).toHaveBeenCalledWith('agents')
    expect(app.setWorkspaceBoardOpen).toHaveBeenCalledWith(true)
  })

  it('closes only when the agent view is already open', () => {
    const app = state(true, 'agents')
    toggleAgentDashboardFromShortcut(app as never)
    expect(app.setWorkspaceBoardOpen).toHaveBeenCalledWith(false)
    expect(app.setSidebarOpen).not.toHaveBeenCalled()
  })
})
