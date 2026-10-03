import { parseExecutionHostId } from '../../../shared/execution-host'
import type { RuntimeEnvironmentStatus } from '@/store/slices/runtime-status-types'
import type { ProjectHostSetup } from '../../../shared/project-types'
import {
  isConnectedRuntimeHostState,
  runtimeHostConnectionStateForEntry
} from '@/runtime/runtime-host-connection-state'

export function getProjectSetupRuntimeOwnerEnvironmentId(
  setup: Pick<ProjectHostSetup, 'hostId' | 'runtimeOwnerEnvironmentId'> | undefined
): string | null {
  const host = parseExecutionHostId(setup?.hostId)
  return setup?.runtimeOwnerEnvironmentId ?? (host?.kind === 'runtime' ? host.environmentId : null)
}

export function getRuntimeEnvironmentConnectionState(entry: RuntimeEnvironmentStatus | undefined) {
  return runtimeHostConnectionStateForEntry(entry)
}

/** Online membership requires positive reachability; unknown/retrying hosts stay in Offline. */
export function getOfflineRuntimeEnvironmentIds(
  statuses: ReadonlyMap<string, RuntimeEnvironmentStatus>,
  knownEnvironmentIds: Iterable<string> = []
): ReadonlySet<string> {
  const offline = new Set(knownEnvironmentIds)
  for (const [environmentId, entry] of statuses) {
    const connection = getRuntimeEnvironmentConnectionState(entry)
    if (isConnectedRuntimeHostState(connection)) {
      offline.delete(environmentId)
    } else {
      offline.add(environmentId)
    }
  }
  return offline
}

export function isOfflineRuntimeOwner(
  hostId: string | null | undefined,
  offlineEnvironmentIds: ReadonlySet<string>,
  runtimeOwnerEnvironmentId?: string | null
): boolean {
  const host = parseExecutionHostId(hostId)
  if (host?.kind === 'runtime') {
    return offlineEnvironmentIds.has(host.environmentId)
  }
  return (
    host?.kind === 'ssh' &&
    Boolean(runtimeOwnerEnvironmentId && offlineEnvironmentIds.has(runtimeOwnerEnvironmentId))
  )
}
