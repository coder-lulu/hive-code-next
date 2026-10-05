import { join } from 'node:path'
import { isNormalizedHiveRuntimeDisplayName } from '../../shared/hive-runtime-display-name'
import {
  HIVE_RUNTIME_DISPLAY_NAME_TASK_ERRORS,
  HIVE_RUNTIME_DISPLAY_NAME_TASK_STATUSES,
  type HiveRuntimePendingDisplayName,
  type HiveRuntimeDisplayNameTaskStatus
} from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  readHiveRuntimeServiceOwnedJson,
  writeHiveRuntimeServiceOwnedJson
} from './hive-runtime-cloud-service-owned-json'

// The quota is scoped so one signed-in account cannot exhaust another account's queue.
export const MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES = 6
export const MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_SCOPES = 8
export const MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_BYTES = 131_072

export type DesktopPendingRuntimeDisplayName = HiveRuntimePendingDisplayName &
  Readonly<{
    authorityId: string
    accountId: string
    expectedResourceVersion: number
    resumeStatus: HiveRuntimeDisplayNameTaskStatus | null
  }>

export type DesktopPendingDisplayNameState = Readonly<{
  schemaVersion: 2
  nextRevision: number
  tasks: readonly DesktopPendingRuntimeDisplayName[]
}>

const EMPTY_STATE: DesktopPendingDisplayNameState = {
  schemaVersion: 2,
  nextRevision: 1,
  tasks: []
}

export type HiveRuntimeDisplayNamePendingStorage = Readonly<{
  read: (path: string) => ReturnType<typeof readHiveRuntimeServiceOwnedJson>
  write: (path: string, value: unknown) => boolean
}>

const defaultStorage: HiveRuntimeDisplayNamePendingStorage = {
  read: (path) =>
    readHiveRuntimeServiceOwnedJson(
      path,
      isReadableState,
      MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_BYTES
    ),
  write: (path, value) =>
    writeHiveRuntimeServiceOwnedJson(path, value, MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_BYTES)
}

export class HiveRuntimeDisplayNamePendingStore {
  private readonly path: string

  constructor(
    userDataPath: string,
    private readonly storage: HiveRuntimeDisplayNamePendingStorage = defaultStorage
  ) {
    this.path = join(userDataPath, 'hive-runtime-cloud', 'display-name-pending.v1.json')
  }

  load(): DesktopPendingDisplayNameState {
    const result = this.storage.read(this.path)
    if (result.status === 'missing') {
      return EMPTY_STATE
    }
    if (result.status === 'ok') {
      if (isPreviousState(result.value)) {
        const backupPath = `${this.path}.before-ownership-epoch.json`
        const backup = this.storage.read(backupPath)
        if (
          backup.status === 'unreadable' ||
          (backup.status === 'missing' && !this.storage.write(backupPath, result.value))
        ) {
          throw new Error('hive_runtime_display_name_pending_migration_failed')
        }
        const migrated = migratePreviousState(result.value)
        this.save(migrated)
        return migrated
      }
      if (isPendingState(result.value)) {
        const persisted = result.value
        const tasks = persisted.tasks.map((task): DesktopPendingRuntimeDisplayName =>
          task.status === 'SUBMITTING'
            ? { ...task, status: 'UNCONFIRMED', errorCode: 'RESULT_UNKNOWN', resumeStatus: null }
            : task
        )
        const recovered = { ...persisted, tasks }
        if (tasks.some((task, index) => task !== persisted.tasks[index])) {
          this.save(recovered)
        }
        return recovered
      }
    }
    throw new Error('hive_runtime_display_name_pending_read_failed')
  }

  save(state: DesktopPendingDisplayNameState): void {
    if (!isPendingState(state) || !this.storage.write(this.path, state)) {
      throw new Error('hive_runtime_display_name_pending_persist_failed')
    }
  }
}

export function desktopPendingTaskMatchesAuthorization(
  task: DesktopPendingRuntimeDisplayName,
  authorization: Pick<HiveRuntimeCloudAuthorization, 'authorityId' | 'accountId'>
): boolean {
  return (
    task.authorityId === authorization.authorityId && task.accountId === authorization.accountId
  )
}

export function isDesktopPendingDisplayNameState(
  value: unknown
): value is DesktopPendingDisplayNameState {
  return isPendingState(value)
}

function isPendingState(value: unknown): value is DesktopPendingDisplayNameState {
  if (!isRecord(value) || value.schemaVersion !== 2 || !Array.isArray(value.tasks)) {
    return false
  }
  return (
    isPositiveInteger(value.nextRevision) &&
    value.tasks.length <=
      MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES * MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_SCOPES &&
    value.tasks.every(isTask) &&
    scopesStayWithinQuota(value.tasks)
  )
}

function scopesStayWithinQuota(
  tasks: readonly { authorityId: string; accountId: string }[]
): boolean {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    const key = `${task.authorityId}\u0000${task.accountId}`
    const count = (counts.get(key) ?? 0) + 1
    if (
      count > MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES ||
      (!counts.has(key) && counts.size >= MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_SCOPES)
    ) {
      return false
    }
    counts.set(key, count)
  }
  return true
}

function isTask(value: unknown): value is DesktopPendingRuntimeDisplayName {
  if (!isRecord(value) || Object.keys(value).length !== 15 || !isTaskIdentity(value)) {
    return false
  }
  return (
    (value.expectedOwnershipEpoch === null || isPositiveInteger(value.expectedOwnershipEpoch)) &&
    HIVE_RUNTIME_DISPLAY_NAME_TASK_STATUSES.some((status) => status === value.status) &&
    (value.resumeStatus === null ||
      HIVE_RUNTIME_DISPLAY_NAME_TASK_STATUSES.some((status) => status === value.resumeStatus)) &&
    (value.errorCode === null ||
      HIVE_RUNTIME_DISPLAY_NAME_TASK_ERRORS.some((error) => error === value.errorCode)) &&
    (value.latestCloudDisplayName === null ||
      isNormalizedHiveRuntimeDisplayName(value.latestCloudDisplayName)) &&
    (value.latestCloudDisplayNameVersion === null ||
      isPositiveInteger(value.latestCloudDisplayNameVersion)) &&
    (value.retryNotBefore === null ||
      (typeof value.retryNotBefore === 'number' &&
        Number.isSafeInteger(value.retryNotBefore) &&
        value.retryNotBefore >= 0)) &&
    (value.confirmedCloudDisplayNameVersion === null ||
      isPositiveInteger(value.confirmedCloudDisplayNameVersion)) &&
    (value.expectedOwnershipEpoch !== null || value.status === 'BLOCKED') &&
    (value.status !== 'CONFIRMED' || isPositiveInteger(value.confirmedCloudDisplayNameVersion))
  )
}

function isTaskIdentity(value: Record<string, unknown>): boolean {
  return (
    isSafeScopeText(value.authorityId) &&
    isSafeScopeText(value.accountId) &&
    typeof value.runtimeRecordId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.runtimeRecordId
    ) &&
    (value.desiredName === null || isNormalizedHiveRuntimeDisplayName(value.desiredName)) &&
    isPositiveInteger(value.expectedCloudDisplayNameVersion) &&
    isPositiveInteger(value.expectedResourceVersion) &&
    isPositiveInteger(value.revision)
  )
}

type PreviousTask = Pick<
  DesktopPendingRuntimeDisplayName,
  | 'authorityId'
  | 'accountId'
  | 'runtimeRecordId'
  | 'desiredName'
  | 'expectedCloudDisplayNameVersion'
  | 'expectedResourceVersion'
  | 'revision'
  | 'confirmedCloudDisplayNameVersion'
> & { dormant: boolean; confirmed: boolean }
type PreviousState = { schemaVersion: 1; nextRevision: number; tasks: PreviousTask[] }

function isPreviousState(value: unknown): value is PreviousState {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isPositiveInteger(value.nextRevision) ||
    !Array.isArray(value.tasks)
  ) {
    return false
  }
  return (
    value.tasks.length <=
      MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES * MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_SCOPES &&
    value.tasks.every(
      (task): task is PreviousTask =>
        isRecord(task) &&
        Object.keys(task).length === 10 &&
        isTaskIdentity(task) &&
        typeof task.dormant === 'boolean' &&
        typeof task.confirmed === 'boolean' &&
        (task.confirmedCloudDisplayNameVersion === null ||
          isPositiveInteger(task.confirmedCloudDisplayNameVersion))
    ) &&
    scopesStayWithinQuota(value.tasks)
  )
}

function isReadableState(value: unknown): value is DesktopPendingDisplayNameState | PreviousState {
  return isPendingState(value) || isPreviousState(value)
}

function migratePreviousState(value: PreviousState): DesktopPendingDisplayNameState {
  return {
    schemaVersion: 2,
    nextRevision: value.nextRevision,
    tasks: value.tasks.map(
      ({
        dormant: _dormant,
        confirmed: _confirmed,
        ...task
      }): DesktopPendingRuntimeDisplayName => ({
        ...task,
        expectedOwnershipEpoch: null,
        status: 'BLOCKED',
        errorCode: 'OWNERSHIP_UNVERIFIED',
        resumeStatus: null,
        latestCloudDisplayName: null,
        latestCloudDisplayNameVersion: null,
        retryNotBefore: null
      })
    )
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isSafeScopeText(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 128) {
    return false
  }
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
