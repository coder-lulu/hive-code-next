import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import type { AgentType } from '../../../../shared/agent-status-types'
import { isTerminalLeafId, makePaneKey } from '../../../../shared/stable-pane-id'
import { structuredAgentSessionPaneKey } from '../../../../shared/structured-agent-session-projection'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/terminal-tab-types'
import { titleForTerminalTab, titleForUnifiedTab } from './sidebar-session-projection'
import { compareWorktreeAgentRows } from './worktree-agent-row-order'
import type { TitleDerivedPaneForeground } from './title-derived-pane-agent-identity'

function unreportedSessionRow(
  tab: TerminalTab,
  paneKey: string,
  agentType: AgentType
): DashboardAgentRow {
  // A saved conversation proves identity, not the current execution state.
  return {
    paneKey,
    tab,
    agentType,
    rowSource: 'live',
    state: 'unverifiable',
    startedAt: 0,
    entry: {
      paneKey,
      tabId: tab.id,
      worktreeId: tab.worktreeId,
      agentType,
      prompt: titleForTerminalTab(tab),
      terminalTitle: tab.title,
      state: 'working',
      restoredUnconfirmed: true,
      stateStartedAt: 0,
      updatedAt: 0,
      stateHistory: []
    }
  }
}

/** Project open conversations even before a restored pane or host status feed is ready. */
export function buildWorktreeSessionRows(args: {
  agents: DashboardAgentRow[]
  tabs: readonly TerminalTab[]
  unifiedTabs: readonly Tab[]
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot | undefined>
  paneForegroundAgentByPaneKey?: Record<string, TitleDerivedPaneForeground>
}): DashboardAgentRow[] {
  const rows = [...args.agents]
  const seen = new Set(rows.map((row) => row.paneKey))
  for (const tab of args.tabs) {
    const agent = tab.launchAgent ?? tab.aiVaultTitle?.agent
    const root = args.terminalLayoutsByTabId[tab.id]?.root
    // A tab-scoped agent identity cannot identify individual split panes.
    if (!agent || root?.type !== 'leaf' || !isTerminalLeafId(root.leafId)) {
      continue
    }
    const paneKey = makePaneKey(tab.id, root.leafId)
    if (args.paneForegroundAgentByPaneKey?.[paneKey]?.shellForeground) {
      continue
    }
    if (!seen.has(paneKey)) {
      rows.push(unreportedSessionRow(tab, paneKey, agent))
      seen.add(paneKey)
    }
  }
  for (const tab of args.unifiedTabs) {
    if (tab.contentType !== 'agent-session' || !tab.agentSessionAgent) {
      continue
    }
    const paneKey = structuredAgentSessionPaneKey(tab.id, tab.entityId)
    if (!seen.has(paneKey)) {
      rows.push(
        unreportedSessionRow(
          {
            id: tab.id,
            worktreeId: tab.worktreeId,
            ptyId: null,
            title: titleForUnifiedTab(tab),
            customTitle: null,
            color: tab.color,
            sortOrder: tab.sortOrder,
            createdAt: tab.createdAt,
            aiVaultTitle: tab.aiVaultTitle
          },
          paneKey,
          tab.agentSessionAgent
        )
      )
      seen.add(paneKey)
    }
  }
  return rows.length === args.agents.length ? args.agents : rows.sort(compareWorktreeAgentRows)
}
