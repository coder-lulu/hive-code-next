import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const rendererRoot = join(__dirname, '../..')

function source(relativePath: string): string {
  return readFileSync(join(rendererRoot, relativePath), 'utf8')
}

describe('agent dashboard performance isolation', () => {
  it('loads the live agent panel only inside the unified board', () => {
    const backgroundServices = source('app-shell/AppBackgroundServices.tsx')
    const sidebar = source('components/sidebar/index.tsx')
    const nav = source('components/sidebar/SidebarNav.tsx')

    expect(backgroundServices).not.toMatch(/from ['"].*DashboardPopoutBridge['"]/)
    expect(backgroundServices).toContain("import('../components/dashboard/DashboardPopoutBridge')")
    expect(sidebar).not.toMatch(/from ['"].*AgentDashboard(?:Drawer|SidebarHost)['"]/)
    expect(source('components/sidebar/WorkspaceBoardDrawer.tsx')).toContain(
      "import('../dashboard/AgentDashboardPanel')"
    )
    expect(nav).not.toContain('useAgentBucketCounts')
    expect(nav).not.toContain('shared/dashboard-snapshot')
    expect(nav).not.toContain('AgentDashboardSidebarEntry')
  })

  it('keeps map computation out of the main-renderer drawer', () => {
    const board = source('components/dashboard-popout/AgentKanbanBoard.tsx')
    const drawer = source('components/sidebar/WorkspaceBoardDrawer.tsx')
    const toolbar = source('components/dashboard-popout/AgentDashboardToolbar.tsx')

    expect(board).not.toContain("import('./AgentDashboardMapView')")
    expect(board).not.toMatch(/from ['"].\/(?:AgentMap|useAgentMap|agent-map-)/)
    expect(toolbar).not.toMatch(/from ['"].\/(?:AgentMap|useAgentMap|agent-map-)/)
    expect(drawer).not.toContain("openPopout?.('map')")
    expect(drawer).not.toContain('onOpenMap')
  })
})
