import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import {
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity
} from '../../../shared/worktree/host-qualified-identity'

export const TOGGLE_FLOATING_TERMINAL_EVENT = 'orca-toggle-floating-terminal'
export const CLOSE_FLOATING_TERMINAL_EVENT = 'orca-close-floating-terminal'

/** True for both the local synthetic bucket and a host-qualified mirror bucket. */
export function isFloatingTerminalWorkspaceId(value: string | null | undefined): boolean {
  if (!value) {
    return false
  }
  return (
    value === FLOATING_TERMINAL_WORKTREE_ID ||
    (isWorktreeHostIdentity(value) &&
      getWorktreeIdFromHostIdentity(value) === FLOATING_TERMINAL_WORKTREE_ID)
  )
}

// Keep one-shot maximize intent across closed→mounted: the panel’s keyboard handler is absent until App opens it.
let openMaximizedIntentAt: number | null = null

// Expire intent if the panel did not mount within the initiating interaction, preventing surprise maximize on later opens.
const OPEN_MAXIMIZED_INTENT_TTL_MS = 2000

export function requestFloatingTerminalOpenMaximized(): void {
  openMaximizedIntentAt = Date.now()
}

export function consumeFloatingTerminalOpenMaximizedIntent(): boolean {
  if (openMaximizedIntentAt === null) {
    return false
  }
  const requestedAt = openMaximizedIntentAt
  openMaximizedIntentAt = null
  return Date.now() - requestedAt <= OPEN_MAXIMIZED_INTENT_TTL_MS
}
