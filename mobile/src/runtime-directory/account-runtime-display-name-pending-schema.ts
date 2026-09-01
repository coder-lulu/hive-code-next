import { normalizeHiveRuntimeDisplayName } from '../../../src/shared/hive-runtime-display-name'
import type { AccountRuntimeDirectoryScope } from './account-runtime-directory-types'

export const MAXIMUM_PENDING_DISPLAY_NAME_TASKS = 16
export const MAXIMUM_PENDING_DISPLAY_NAME_SCOPES = 8
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export type PendingRuntimeDisplayName = Readonly<{
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

export type PendingDisplayNameState = Readonly<{
  schemaVersion: 1
  nextRevision: number
  tasks: readonly PendingRuntimeDisplayName[]
}>

export const EMPTY_PENDING_DISPLAY_NAME_STATE: PendingDisplayNameState = {
  schemaVersion: 1,
  nextRevision: 1,
  tasks: []
}

export function isPendingDisplayNameState(value: unknown): value is PendingDisplayNameState {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.tasks)) {
    return false
  }
  return (
    Number.isSafeInteger(value.nextRevision) &&
    (value.nextRevision as number) >= 1 &&
    value.tasks.length <=
      MAXIMUM_PENDING_DISPLAY_NAME_TASKS * MAXIMUM_PENDING_DISPLAY_NAME_SCOPES &&
    value.tasks.every(isPendingTask) &&
    scopesStayWithinQuota(value.tasks)
  )
}

function scopesStayWithinQuota(tasks: readonly PendingRuntimeDisplayName[]): boolean {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    const key = `${task.authorityId}\u0000${task.accountId}`
    const count = (counts.get(key) ?? 0) + 1
    if (
      count > MAXIMUM_PENDING_DISPLAY_NAME_TASKS ||
      (!counts.has(key) && counts.size >= MAXIMUM_PENDING_DISPLAY_NAME_SCOPES)
    ) {
      return false
    }
    counts.set(key, count)
  }
  return true
}

export function assertPendingDisplayNameScope(scope: AccountRuntimeDirectoryScope): void {
  if (
    !scope.authorityId ||
    scope.authorityId.length > 128 ||
    hasAsciiControl(scope.authorityId) ||
    !scope.accountId ||
    scope.accountId.length > 128 ||
    hasAsciiControl(scope.accountId)
  ) {
    throw new Error('runtime_display_name_scope_invalid')
  }
}

export function assertPendingRuntimeRecordId(value: string): void {
  if (!CANONICAL_UUID_PATTERN.test(value)) {
    throw new Error('runtime_display_name_target_invalid')
  }
}

export function assertPendingPositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('runtime_display_name_version_invalid')
  }
}

function isPendingTask(value: unknown): value is PendingRuntimeDisplayName {
  if (!isRecord(value) || Object.keys(value).length !== 10) {
    return false
  }
  try {
    assertPendingDisplayNameScope({
      authorityId: value.authorityId as string,
      accountId: value.accountId as string
    })
    assertPendingRuntimeRecordId(value.runtimeRecordId as string)
    assertPendingPositiveInteger(value.expectedCloudDisplayNameVersion as number)
    assertPendingPositiveInteger(value.expectedResourceVersion as number)
    assertPendingPositiveInteger(value.revision as number)
    return (
      (value.desiredName === null ||
        normalizeHiveRuntimeDisplayName(value.desiredName as string) === value.desiredName) &&
      typeof value.dormant === 'boolean' &&
      typeof value.confirmed === 'boolean' &&
      (value.confirmedCloudDisplayNameVersion === null ||
        (Number.isSafeInteger(value.confirmedCloudDisplayNameVersion) &&
          (value.confirmedCloudDisplayNameVersion as number) >= 1))
    )
  } catch {
    return false
  }
}

function hasAsciiControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
