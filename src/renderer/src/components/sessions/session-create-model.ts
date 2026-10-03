import type { SessionListScope } from '../../../../shared/session-list-scope'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import type { DesktopHomeEntityProjection } from '../landing/desktop-home-model-entities'
import type { DesktopHomeWorkspace } from '../landing/desktop-home-model-types'
import type { AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'

export function sessionCreateWorkspaces(
  entities: DesktopHomeEntityProjection,
  scope: SessionListScope
) {
  if (scope.kind === 'unassigned') {
    return []
  }
  if (scope.kind === 'workspace') {
    return entities.workspaces.filter(
      (w) =>
        [w.id, w.workspaceKey].includes(scope.workspaceKey) &&
        w.executionHostId === scope.executionHostId
    )
  }
  if (scope.kind === 'project') {
    const workspaces = entities.projectsByIdentity.get(scope.projectKey)?.workspaces ?? []
    const workspaceKey = 'workspaceKey' in scope ? scope.workspaceKey : undefined
    return workspaceKey ? workspaces.filter((w) => w.identityKey === workspaceKey) : workspaces
  }
  return entities.workspaces
}

export function sessionCreateOwner(workspace?: DesktopHomeWorkspace) {
  return {
    worktreeId: workspace
      ? workspace.kind === 'folder'
        ? workspace.workspaceKey
        : workspace.id
      : FLOATING_TERMINAL_WORKTREE_ID,
    executionHostId: workspace?.executionHostId ?? ('local' as const)
  }
}

export function sessionCreateDetectionTarget(
  workspace?: DesktopHomeWorkspace
): AgentDetectionTarget | undefined {
  const owner = sessionCreateOwner(workspace)
  const host = parseExecutionHostId(owner.executionHostId)
  if (host?.kind === 'ssh') {
    return { kind: 'ssh', connectionId: host.targetId }
  }
  if (host?.kind === 'runtime') {
    return { kind: 'runtime', environmentId: host.environmentId }
  }
  if (host?.kind === 'local') {
    return {
      kind: 'local',
      worktreeId: owner.worktreeId,
      ...(workspace ? {} : { contextKey: 'host' })
    }
  }
  return undefined
}
