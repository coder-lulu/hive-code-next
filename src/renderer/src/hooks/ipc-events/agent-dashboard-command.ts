import type { AppState } from '../../store/types'

export function toggleAgentDashboardFromShortcut(
  state: Pick<
    AppState,
    | 'activeView'
    | 'workspaceBoardOpen'
    | 'workspaceBoardView'
    | 'setSidebarOpen'
    | 'setWorkspaceBoardOpen'
    | 'setWorkspaceBoardView'
  >
): void {
  if (state.activeView === 'settings') {
    return
  }
  const nextOpen = !state.workspaceBoardOpen || state.workspaceBoardView !== 'agents'
  // The drawer self-closes with the sidebar: reveal only when opening, never while closing.
  if (nextOpen) {
    state.setSidebarOpen(true)
    state.setWorkspaceBoardView('agents')
  }
  state.setWorkspaceBoardOpen(nextOpen)
}
