import { FLOATING_TERMINAL_WORKTREE_ID } from './constants'
import type { TerminalTab } from './terminal-tab-types'
import {
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity
} from './worktree/host-qualified-identity'

/** Session-backed agent tabs remain user-restorable after their transient PTY exits. */
export function isTerminalTabSessionRecord(
  tab: Pick<TerminalTab, 'aiVaultTitle' | 'launchAgent'>
): boolean {
  return Boolean(tab.launchAgent || tab.aiVaultTitle?.sessionId)
}

/** The floating workspace owns durable session history; normal worktrees keep strict PTY liveness. */
export function isFloatingTerminalSessionRecord(
  tab: Pick<TerminalTab, 'aiVaultTitle' | 'launchAgent' | 'worktreeId'>,
  ownerWorktreeId: string = tab.worktreeId
): boolean {
  const worktreeId = isWorktreeHostIdentity(ownerWorktreeId)
    ? getWorktreeIdFromHostIdentity(ownerWorktreeId)
    : ownerWorktreeId
  return worktreeId === FLOATING_TERMINAL_WORKTREE_ID && isTerminalTabSessionRecord(tab)
}
