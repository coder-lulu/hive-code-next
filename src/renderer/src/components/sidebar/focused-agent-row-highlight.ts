import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { isTerminalLeafId, makePaneKey } from '../../../../shared/stable-pane-id'
import { structuredAgentSessionPaneKey } from '../../../../shared/structured-agent-session-projection'
import {
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity
} from '../../../../shared/worktree/host-qualified-identity'
import { getSidebarActiveSessionTarget } from './sidebar-session-active-target'

export type FocusedAgentRowHighlightState = Pick<
  AppState,
  | 'activeView'
  | 'activeWorktreeId'
  | 'activeTabType'
  | 'activeTabId'
  | 'tabsByWorktree'
  | 'terminalLayoutsByTabId'
  | 'activeGroupIdByWorktree'
  | 'groupsByWorktree'
  | 'unifiedTabsByWorktree'
>

export function getFocusedAgentPaneKeyForWorktree(
  state: FocusedAgentRowHighlightState,
  worktreeId: string
): string | null {
  const target = getSidebarActiveSessionTarget(state)
  if (!target || target.ownerBucketKey !== worktreeId) {
    return null
  }

  if (state.activeTabType === 'agent-session') {
    const rawWorktreeId = isWorktreeHostIdentity(worktreeId)
      ? getWorktreeIdFromHostIdentity(worktreeId)
      : worktreeId
    const tab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (candidate) =>
        candidate.id === target.unifiedTabId &&
        candidate.contentType === 'agent-session' &&
        (candidate.worktreeId === worktreeId || candidate.worktreeId === rawWorktreeId) &&
        candidate.groupId === state.activeGroupIdByWorktree[worktreeId]
    )
    return tab ? structuredAgentSessionPaneKey(tab.id, tab.entityId) : null
  }

  const activeTabId = target.terminalTabId
  if (!activeTabId) {
    return null
  }

  const activeTabBelongsToWorktree = (state.tabsByWorktree[worktreeId] ?? []).some(
    (tab) => tab.id === activeTabId
  )
  if (!activeTabBelongsToWorktree) {
    return null
  }

  const activeLeafId = state.terminalLayoutsByTabId[activeTabId]?.activeLeafId
  if (!activeLeafId || !isTerminalLeafId(activeLeafId)) {
    return null
  }

  return makePaneKey(activeTabId, activeLeafId)
}

export function useFocusedAgentPaneKey(worktreeId: string): string | null {
  return useAppStore((state) => getFocusedAgentPaneKeyForWorktree(state, worktreeId))
}
