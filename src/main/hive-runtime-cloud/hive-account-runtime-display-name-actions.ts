import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type {
  HiveAccountRuntimeDirectoryState,
  HiveRuntimeDisplayNameUpdateRequest
} from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeDisplayNameCoordinator } from './hive-runtime-display-name-coordinator'

export function enqueueAccountRuntimeDisplayName(
  coordinator: HiveRuntimeDisplayNameCoordinator | null,
  authorization: HiveRuntimeCloudAuthorization | null,
  directory: HiveAccountRuntimeDirectoryState,
  request: HiveRuntimeDisplayNameUpdateRequest
): void {
  if (!coordinator || !authorization) {
    throw new Error('hive_runtime_display_name_unavailable')
  }
  const entry = directory.items.find(
    (candidate) => candidate.runtimeRecordId === request.runtimeRecordId
  )
  if (
    !entry ||
    entry.cloudDisplayNameVersion == null ||
    entry.cloudDisplayNameVersion !== request.expectedCloudDisplayNameVersion ||
    entry.ownershipEpoch !== request.expectedOwnershipEpoch
  ) {
    throw new Error('hive_runtime_display_name_stale')
  }
  coordinator.enqueue({
    runtimeRecordId: entry.runtimeRecordId,
    desiredName: request.cloudDisplayName,
    expectedCloudDisplayNameVersion: entry.cloudDisplayNameVersion,
    expectedResourceVersion: entry.resourceVersion,
    expectedOwnershipEpoch: entry.ownershipEpoch,
    pendingRevision: request.pendingRevision
  })
}

export function projectAccountRuntimeDisplayNameState(
  directory: HiveAccountRuntimeDirectoryState,
  coordinator: HiveRuntimeDisplayNameCoordinator | null,
  supportsWrite: boolean
): HiveAccountRuntimeDirectoryState {
  return {
    ...directory,
    pendingDisplayNames: coordinator?.getPending() ?? [],
    displayNameSyncError:
      coordinator?.getStorageError() ??
      (supportsWrite && !coordinator ? 'PENDING_STORE_UNAVAILABLE' : null)
  }
}
