import { useAppStore } from '@/store'
import type { ConnectPanePtySession } from './connect-pane-pty-session'
import { resolveTerminalTabId } from './terminal-tab-id'

export function shouldContinueFreshSpawn(session: ConnectPanePtySession): boolean {
  const state = useAppStore.getState()
  const unifiedTab = state.getTab?.(session.deps.tabId)
  const initialOwnerWorktreeId =
    state.getTerminalTabOwnerWorktreeId?.(session.deps.tabId) ??
    (unifiedTab?.contentType === 'terminal'
      ? state.getTerminalTabOwnerWorktreeId?.(unifiedTab.entityId)
      : null)
  const terminalTabId = resolveTerminalTabId(
    {
      getTab: state.getTab,
      hasTerminalTab: (candidateId) =>
        Boolean(
          state.tabsByWorktree[session.deps.worktreeId]?.some((tab) => tab.id === candidateId) ||
          (initialOwnerWorktreeId
            ? state.tabsByWorktree[initialOwnerWorktreeId]?.some((tab) => tab.id === candidateId)
            : false)
        )
    },
    session.deps.tabId
  )
  const ownerWorktreeId =
    state.getTerminalTabOwnerWorktreeId?.(terminalTabId) ?? initialOwnerWorktreeId
  const terminalTab =
    state.tabsByWorktree[session.deps.worktreeId]?.find((tab) => tab.id === terminalTabId) ??
    (ownerWorktreeId
      ? state.tabsByWorktree[ownerWorktreeId]?.find((tab) => tab.id === terminalTabId)
      : undefined)
  const fallbackTab = Object.values(state.tabsByWorktree)
    .find((tabs) => tabs.some((tab) => tab.id === terminalTabId))
    ?.find((tab) => tab.id === terminalTabId)
  const currentTab =
    terminalTab ?? fallbackTab ?? (unifiedTab && 'generation' in unifiedTab ? unifiedTab : null)
  return !session.disposed && (currentTab?.generation ?? 0) === session.tabGeneration
}
