export type HostRouteActionState = {
  routeAction: string | undefined
  showNewWorktree: boolean
}

export function hostRoute(hostId: string): `/h/${string}` {
  return `/h/${encodeURIComponent(hostId)}`
}

export function hostAccountsRoute(hostId: string): `/h/${string}/accounts` {
  return `${hostRoute(hostId)}/accounts`
}

export function hostTasksRoute(hostId: string): `/h/${string}/tasks` {
  return `${hostRoute(hostId)}/tasks`
}

export function hostNewWorktreeRoute(hostId: string): `/h/${string}?action=newWorktree` {
  return `${hostRoute(hostId)}?action=newWorktree`
}

export function hostNewWorktreeSessionRoute(
  hostId: string,
  worktreeId: string,
  worktreeName: string,
  /** Host-reported create warning (e.g. the startup terminal failed to spawn). */
  warning?: string
): `/h/${string}/session/${string}?${string}` {
  const params = new URLSearchParams({ name: worktreeName, created: '1' })
  if (warning?.trim()) {
    params.set('warning', warning)
  }
  return `${hostRoute(hostId)}/session/${encodeURIComponent(worktreeId)}?${params}`
}

export function createInitialHostRouteActionState(
  routeAction: string | undefined
): HostRouteActionState {
  return {
    routeAction,
    showNewWorktree: routeAction === 'newWorktree'
  }
}

export function resolveHostRouteActionState(
  current: HostRouteActionState,
  routeAction: string | undefined
): HostRouteActionState {
  if (current.routeAction === routeAction) {
    return current
  }
  return {
    routeAction,
    showNewWorktree: current.showNewWorktree || routeAction === 'newWorktree'
  }
}

export function setHostRouteNewWorktreeVisible(
  current: HostRouteActionState,
  showNewWorktree: boolean
): HostRouteActionState {
  if (current.showNewWorktree === showNewWorktree) {
    return current
  }
  return { ...current, showNewWorktree }
}
