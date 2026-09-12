import { useAppStore } from '@/store'
import type { ConnectPanePtySession } from './connect-pane-pty-session'
import { findTerminalTabForPane } from './terminal-tab-id'

export function shouldContinueFreshSpawn(session: ConnectPanePtySession): boolean {
  const currentTab = findTerminalTabForPane(
    useAppStore.getState(),
    session.deps.worktreeId,
    session.deps.tabId
  )
  return !session.disposed && (currentTab?.generation ?? 0) === session.tabGeneration
}
