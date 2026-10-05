import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveRuntimeDisplayNameTaskError
} from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  desktopPendingTaskMatchesAuthorization,
  type DesktopPendingRuntimeDisplayName
} from './hive-runtime-display-name-pending-store'

export function blockRuntimeDisplayNameTask(
  task: DesktopPendingRuntimeDisplayName,
  errorCode: HiveRuntimeDisplayNameTaskError
): DesktopPendingRuntimeDisplayName {
  return {
    ...task,
    status: 'BLOCKED',
    errorCode,
    resumeStatus:
      task.status === 'BLOCKED'
        ? task.resumeStatus
        : task.status === 'SUBMITTING'
          ? 'UNCONFIRMED'
          : task.status
  }
}

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
    if (!entry) {
      return [blockRuntimeDisplayNameTask(task, 'TARGET_UNAVAILABLE')]
    }
    const latest = {
      ...task,
      latestCloudDisplayName: entry.cloudDisplayName ?? null,
      latestCloudDisplayNameVersion: entry.cloudDisplayNameVersion ?? null
    }
    if (task.expectedOwnershipEpoch === null) {
      return [blockRuntimeDisplayNameTask(latest, 'OWNERSHIP_UNVERIFIED')]
    }
    if (entry.ownershipEpoch !== task.expectedOwnershipEpoch) {
      return [blockRuntimeDisplayNameTask(latest, 'OWNERSHIP_CHANGED')]
    }
    if (task.errorCode === 'OWNERSHIP_CHANGED' || task.errorCode === 'OWNERSHIP_UNVERIFIED') {
      return [task]
    }
    if (entry.cloudDisplayNameVersion == null) {
      return [blockRuntimeDisplayNameTask(task, 'READ_UNAVAILABLE')]
    }
    const knownVersion = Math.max(
      task.expectedCloudDisplayNameVersion,
      task.latestCloudDisplayNameVersion ?? 0,
      task.confirmedCloudDisplayNameVersion ?? 0
    )
    if (entry.cloudDisplayNameVersion < knownVersion) {
      return [task]
    }
    if (task.status === 'CONFIRMED') {
      return entry.cloudDisplayNameVersion < (task.confirmedCloudDisplayNameVersion ?? Infinity)
        ? [latest]
        : []
    }
    const current: DesktopPendingRuntimeDisplayName =
      task.status === 'BLOCKED' && task.errorCode !== 'REQUEST_REJECTED'
        ? {
            ...latest,
            status: task.resumeStatus ?? 'UNCONFIRMED',
            errorCode: null,
            resumeStatus: null
          }
        : latest
    if (current.status === 'BLOCKED') {
      return [current]
    }
    if ((entry.cloudDisplayName ?? null) === task.desiredName) {
      return [
        {
          ...current,
          status: 'CONFIRMED',
          errorCode: null,
          resumeStatus: null,
          confirmedCloudDisplayNameVersion: entry.cloudDisplayNameVersion
        }
      ]
    }
    if (
      entry.cloudDisplayNameVersion > task.expectedCloudDisplayNameVersion ||
      current.status === 'CONFLICT'
    ) {
      return [{ ...current, status: 'CONFLICT', errorCode: 'VERSION_CONFLICT', resumeStatus: null }]
    }
    return [current]
  })
}
