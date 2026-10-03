import { join } from 'node:path'
import { normalizeHiveRuntimeDisplayName } from '../../shared/hive-runtime-display-name'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  readHiveRuntimeServiceOwnedJson,
  writeHiveRuntimeServiceOwnedJson
} from './hive-runtime-cloud-service-owned-json'

// The quota is scoped so one signed-in account cannot exhaust another account's queue.
export const MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES = 6
export const MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_SCOPES = 8
export const MAXIMUM_DESKTOP_PENDING_DISPLAY_NAME_BYTES = 131_072

export type DesktopPendingRuntimeDisplayName = Readonly<{
  authorityId: string
  accountId: string
  runtimeRecordId: string
  desiredName: string | null
  expectedCloudDisplayNameVersion: number
  expectedResourceVersion: number
  revision: number
  dormant: boolean
  confirmed: boolean
  confirmedCloudDisplayNameVersion: number | null
}>

export type DesktopPendingDisplayNameState = Readonly<{
  schemaVersion: 1
  nextRevision: number
  tasks: readonly DesktopPendingRuntimeDisplayName[]
}>

const EMPTY_STATE: DesktopPendingDisplayNameState = {
  schemaVersion: 1,
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
      isPendingState,
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
    if (result.status === 'ok' && isPendingState(result.value)) {
      return result.value
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
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.tasks)) {
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

function scopesStayWithinQuota(tasks: readonly DesktopPendingRuntimeDisplayName[]): boolean {
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
  if (!isRecord(value) || Object.keys(value).length !== 10) {
    return false
  }
  return (
    isSafeScopeText(value.authorityId) &&
    isSafeScopeText(value.accountId) &&
    typeof value.runtimeRecordId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.runtimeRecordId
    ) &&
    (value.desiredName === null ||
      (typeof value.desiredName === 'string' &&
        normalizeSafely(value.desiredName) === value.desiredName)) &&
    isPositiveInteger(value.expectedCloudDisplayNameVersion) &&
    isPositiveInteger(value.expectedResourceVersion) &&
    isPositiveInteger(value.revision) &&
    typeof value.dormant === 'boolean' &&
    typeof value.confirmed === 'boolean' &&
    (value.confirmedCloudDisplayNameVersion === null ||
      isPositiveInteger(value.confirmedCloudDisplayNameVersion))
  )
}

function normalizeSafely(value: string): string | null {
  try {
    return normalizeHiveRuntimeDisplayName(value)
  } catch {
    return null
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
