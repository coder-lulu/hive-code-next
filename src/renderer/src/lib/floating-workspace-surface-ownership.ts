import { isFloatingTerminalWorkspaceId } from './floating-terminal'

export type FloatingWorkspaceMainSurface = {
  id: string
  path: string
}

/**
 * The main workbench must be able to claim the synthetic workspace before its
 * local cwd lookup finishes. An empty path is intentional: terminal hosts can
 * use their default directory while Electron resolves the configured path.
 */
export function resolveActiveFloatingWorkspaceSurface(
  activeWorktreeId: string | null,
  resolvedCwd: string | null
): FloatingWorkspaceMainSurface | null {
  if (!activeWorktreeId || !isFloatingTerminalWorkspaceId(activeWorktreeId)) {
    return null
  }
  return {
    id: activeWorktreeId,
    path: resolvedCwd ?? ''
  }
}

export function mainWorkbenchOwnsFloatingWorkspace(
  activeView: string,
  activeWorktreeId: string | null
): boolean {
  return (
    activeView === 'sessions' ||
    (activeView === 'terminal' && isFloatingTerminalWorkspaceId(activeWorktreeId))
  )
}

export function shouldMountFloatingWorkspacePanel(args: {
  enabled: boolean
  open: boolean
  visibleTabCount: number
  mainWorkbenchOwnsWorkspace: boolean
}): boolean {
  return args.enabled && !args.mainWorkbenchOwnsWorkspace && (args.open || args.visibleTabCount > 0)
}
