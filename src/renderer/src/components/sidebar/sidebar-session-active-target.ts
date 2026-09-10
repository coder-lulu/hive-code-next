import type { AppState } from '@/store/types'
import type { TemporarySessionItem } from './sidebar-session-model'

export type SidebarActiveSessionTarget = {
  ownerBucketKey: string
  unifiedTabId: string | null
  terminalTabId: string | null
}

type SidebarActiveSessionState = Pick<
  AppState,
  | 'activeView'
  | 'activeWorktreeId'
  | 'activeTabType'
  | 'activeTabId'
  | 'activeGroupIdByWorktree'
  | 'groupsByWorktree'
>

export function getSidebarActiveSessionTarget(
  state: SidebarActiveSessionState
): SidebarActiveSessionTarget | null {
  if (
    state.activeView !== 'terminal' ||
    !state.activeWorktreeId ||
    (state.activeTabType !== 'terminal' && state.activeTabType !== 'agent-session')
  ) {
    return null
  }

  const ownerBucketKey = state.activeWorktreeId
  const activeGroupId = state.activeGroupIdByWorktree[ownerBucketKey]
  const activeUnifiedTabId =
    (state.groupsByWorktree[ownerBucketKey] ?? []).find((group) => group.id === activeGroupId)
      ?.activeTabId ?? null
  const activeTerminalTabId = state.activeTabType === 'terminal' ? state.activeTabId : null

  if (!activeUnifiedTabId && !activeTerminalTabId) {
    return null
  }
  return { ownerBucketKey, unifiedTabId: activeUnifiedTabId, terminalTabId: activeTerminalTabId }
}

export function isSidebarSessionActive(
  item: Pick<
    TemporarySessionItem,
    'ownerBucketKey' | 'worktreeId' | 'unifiedTabId' | 'terminalTabId'
  >,
  activeTarget: SidebarActiveSessionTarget | null
): boolean {
  if (!activeTarget || (item.ownerBucketKey ?? item.worktreeId) !== activeTarget.ownerBucketKey) {
    return false
  }
  return Boolean(
    (item.unifiedTabId && item.unifiedTabId === activeTarget.unifiedTabId) ||
    (item.terminalTabId && item.terminalTabId === activeTarget.terminalTabId)
  )
}
