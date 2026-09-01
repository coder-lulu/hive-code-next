import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  desktopPendingTaskMatchesAuthorization,
  type DesktopPendingRuntimeDisplayName
} from './hive-runtime-display-name-pending-store'

export function reconcileDesktopRuntimeDisplayNames(
  tasks: readonly DesktopPendingRuntimeDisplayName[],
  authorization: HiveRuntimeCloudAuthorization,
  entries: readonly HiveAccountRuntimeDirectoryEntry[]
): readonly DesktopPendingRuntimeDisplayName[] {
  const byId = new Map(entries.map((entry) => [entry.runtimeRecordId, entry]))
  return tasks.flatMap((task): DesktopPendingRuntimeDisplayName[] => {
    if (!desktopPendingTaskMatchesAuthorization(task, authorization)) {
      return [task]
    }
    const entry = byId.get(task.runtimeRecordId)
    if (!entry || (entry.cloudDisplayName ?? null) === task.desiredName) {
      return []
    }
    if (task.confirmed && entry.resourceVersion !== task.expectedResourceVersion) {
      return []
    }
    if (entry.cloudDisplayNameVersion == null) {
      return task.dormant ? [task] : [{ ...task, dormant: true }]
    }
    if (task.confirmed) {
      return task.confirmedCloudDisplayNameVersion != null &&
        entry.cloudDisplayNameVersion < task.confirmedCloudDisplayNameVersion
        ? [task]
        : []
    }
    if (entry.resourceVersion !== task.expectedResourceVersion) {
      return task.dormant ? [{ ...task, dormant: false }] : [task]
    }
    if (task.dormant || task.expectedCloudDisplayNameVersion !== entry.cloudDisplayNameVersion) {
      return [
        {
          ...task,
          dormant: false,
          expectedCloudDisplayNameVersion: entry.cloudDisplayNameVersion
        }
      ]
    }
    return [task]
  })
}
