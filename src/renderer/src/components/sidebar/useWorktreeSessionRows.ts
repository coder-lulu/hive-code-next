import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { EMPTY_TABS } from './WorktreeCardHelpers'
import { useWorktreeAgentRows } from './useWorktreeAgentRows'
import {
  EMPTY_TERMINAL_LAYOUTS,
  selectTerminalLayoutsForWorktree
} from './worktree-agent-row-selectors'
import { buildWorktreeSessionRows } from './worktree-session-rows'
import type { Tab } from '../../../../shared/tab-types'
import {
  EMPTY_PANE_FOREGROUND_AGENTS,
  selectPaneForegroundAgentsForWorktree
} from './worktree-card-status-inputs'

const EMPTY_UNIFIED_TABS: Tab[] = []

export function useWorktreeSessionRows(worktreeId: string, active: boolean) {
  const agents = useWorktreeAgentRows(worktreeId, active)
  const tabs = useAppStore((state) =>
    active ? (state.tabsByWorktree[worktreeId] ?? EMPTY_TABS) : EMPTY_TABS
  )
  const unifiedTabs = useAppStore((state) =>
    active ? (state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS) : EMPTY_UNIFIED_TABS
  )
  const terminalLayoutsByTabId = useAppStore(
    useShallow((state) =>
      active ? selectTerminalLayoutsForWorktree(state, worktreeId) : EMPTY_TERMINAL_LAYOUTS
    )
  )
  const paneForegroundAgentByPaneKey = useAppStore(
    useShallow((state) =>
      active
        ? selectPaneForegroundAgentsForWorktree(state, worktreeId)
        : EMPTY_PANE_FOREGROUND_AGENTS
    )
  )
  return useMemo(
    () =>
      active
        ? buildWorktreeSessionRows({
            agents,
            tabs,
            unifiedTabs,
            terminalLayoutsByTabId,
            paneForegroundAgentByPaneKey
          })
        : agents,
    [active, agents, tabs, unifiedTabs, terminalLayoutsByTabId, paneForegroundAgentByPaneKey]
  )
}
