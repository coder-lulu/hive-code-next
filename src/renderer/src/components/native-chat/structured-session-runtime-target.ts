import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import type { Tab } from '../../../../shared/tab-types'
import {
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity
} from '../../../../shared/worktree/host-qualified-identity'
import { isFloatingTerminalWorkspaceId } from '@/lib/floating-terminal'
import { resolveExplicitWorktreeOperationRouteResult } from '@/lib/worktree-operation-catalog-route'
import { runtimeTargetForExecutionHostId } from '@/runtime/runtime-client-target'
import type { AppState } from '@/store/types'

type OwnerCatalog = Pick<
  AppState,
  'repos' | 'worktreesByRepo' | 'folderWorkspaces' | 'projectGroups'
>

export function resolveStructuredSessionRuntimeTarget(
  state: OwnerCatalog,
  bucket: string,
  tab: Tab
) {
  const bucketHost = getExecutionHostIdFromWorktreeHostIdentity(bucket)
  const tabHost = tab.executionHostId ?? getExecutionHostIdFromWorktreeHostIdentity(tab.worktreeId)
  if (bucketHost && tabHost && bucketHost !== tabHost) {
    return null
  }
  const explicitHost = bucketHost ?? tabHost
  if (explicitHost) {
    return runtimeTargetForExecutionHostId(explicitHost)
  }
  if (isFloatingTerminalWorkspaceId(bucket)) {
    return runtimeTargetForExecutionHostId('local')
  }
  const workspaceId = getWorktreeIdFromHostIdentity(bucket)
  const scope = parseWorkspaceKey(workspaceId)
  if (scope?.type === 'folder') {
    const folders = state.folderWorkspaces.filter((folder) => folder.id === scope.folderWorkspaceId)
    if (folders.length !== 1) {
      return null
    }
    const folder = folders[0]
    const groups = state.projectGroups.filter((group) => group.id === folder.projectGroupId)
    if (!folder.executionHostId && !folder.connectionId && groups.length > 1) {
      return null
    }
    const owner = folder.executionHostId || folder.connectionId ? folder : (groups[0] ?? folder)
    const host = parseExecutionHostId(owner.executionHostId)
    if (owner.executionHostId && !host) {
      return null
    }
    return runtimeTargetForExecutionHostId(
      getRepoExecutionHostId({
        executionHostId: host?.id,
        connectionId: owner.connectionId
      })
    )
  }
  const resolution = resolveExplicitWorktreeOperationRouteResult(state, workspaceId)
  const hostId = resolution.kind === 'resolved' ? resolution.route.executionHostId : null
  const host = parseExecutionHostId(hostId)
  return host ? runtimeTargetForExecutionHostId(host.id) : null
}
