import { getResolvedExecutionHostIdForWorktree } from './resolved-worktree-execution-host'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { SessionListItem } from '@/components/sessions/session-list-types'
import { createSessionCollectionSelector } from '@/components/sessions/use-session-collection'

export function selectCreatedWorkspaceSession(
  items: readonly SessionListItem[],
  ownerBucketKey: string,
  executionHostId: ExecutionHostId,
  activeUnifiedTabId: string | null,
  activeTerminalTabId: string | null
): string | null {
  const matches = items.filter(
    (item) => item.ownerBucketKey === ownerBucketKey && item.executionHostId === executionHostId
  )
  const selected = activeUnifiedTabId
    ? matches.filter((item) => item.unifiedTabId === activeUnifiedTabId)
    : matches.filter((item) => activeTerminalTabId && item.terminalTabId === activeTerminalTabId)
  return selected.length === 1 ? selected[0].key : null
}

/** Completion is allowed to navigate only the owner that creation actually activated. */
export function returnCreatedWorkspaceToSessions(
  worktreeId: string,
  state: AppState = useAppStore.getState()
): boolean {
  if (state.activeWorktreeId !== worktreeId) {
    return false
  }
  // Legacy activation stores a null host even for a hydrated local owner.
  // Resolve from that owner rather than guessing local or using focused runtime.
  const hostId =
    state.activeWorkspaceExecutionHostId ?? getResolvedExecutionHostIdForWorktree(state, worktreeId)
  if (!hostId) {
    return false
  }
  const group = state.groupsByWorktree[worktreeId]?.find(
    (candidate) => candidate.id === state.activeGroupIdByWorktree[worktreeId]
  )
  const { items } = createSessionCollectionSelector()(state)
  const selectedSessionKey = selectCreatedWorkspaceSession(
    items,
    worktreeId,
    hostId,
    group?.activeTabId ?? null,
    state.activeTabIdByWorktree[worktreeId] ?? null
  )
  state.openSessionsPage({ kind: 'workspace', workspaceKey: worktreeId, executionHostId: hostId })
  state.updateSessionsView({ selectedSessionKey, query: '', scrollTop: 0 })
  return true
}
