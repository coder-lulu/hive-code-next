/* eslint-disable max-lines -- Why: queue validation, serialization, retry mutations, and
   directory reconciliation share one persisted-state invariant. */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizeHiveRuntimeDisplayName } from '../../../src/shared/hive-runtime-display-name'
import { PRODUCT_STORAGE_NAMESPACE } from '../product-brand'
import type {
  AccountRuntimeDirectoryEntry,
  AccountRuntimeDirectoryScope
} from './account-runtime-directory-types'
import {
  assertPendingDisplayNameScope,
  assertPendingPositiveInteger,
  assertPendingRuntimeRecordId,
  EMPTY_PENDING_DISPLAY_NAME_STATE,
  isPendingDisplayNameState,
  MAXIMUM_PENDING_DISPLAY_NAME_SCOPES,
  MAXIMUM_PENDING_DISPLAY_NAME_TASKS,
  type PendingDisplayNameState,
  type PendingRuntimeDisplayName
} from './account-runtime-display-name-pending-schema'

export type { PendingRuntimeDisplayName } from './account-runtime-display-name-pending-schema'

export type PendingDisplayNameRetryMutation =
  | Readonly<{ kind: 'remove'; task: PendingRuntimeDisplayName }>
  | Readonly<{ kind: 'dormant'; task: PendingRuntimeDisplayName }>
  | Readonly<{
      kind: 'confirmed'
      task: PendingRuntimeDisplayName
      confirmedCloudDisplayNameVersion: number
    }>

const STORAGE_KEY = `${PRODUCT_STORAGE_NAMESPACE}.account-runtime-display-name-pending.v1`

type Storage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>

export class AccountRuntimeDisplayNamePendingStore {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly storage: Storage = AsyncStorage) {}

  loadScope(scope: AccountRuntimeDirectoryScope): Promise<readonly PendingRuntimeDisplayName[]> {
    return this.serialized(async () =>
      (await this.read()).tasks.filter((task) => taskMatchesScope(task, scope))
    )
  }

  loadTask(
    scope: AccountRuntimeDirectoryScope,
    runtimeRecordId: string
  ): Promise<PendingRuntimeDisplayName | null> {
    return this.serialized(
      async () =>
        (await this.read()).tasks.find(
          (task) => task.runtimeRecordId === runtimeRecordId && taskMatchesScope(task, scope)
        ) ?? null
    )
  }

  enqueue(args: {
    scope: AccountRuntimeDirectoryScope
    runtimeRecordId: string
    desiredName: string | null
    expectedCloudDisplayNameVersion: number
    expectedResourceVersion: number
  }): Promise<PendingRuntimeDisplayName> {
    assertPendingDisplayNameScope(args.scope)
    assertPendingRuntimeRecordId(args.runtimeRecordId)
    assertPendingPositiveInteger(args.expectedCloudDisplayNameVersion)
    assertPendingPositiveInteger(args.expectedResourceVersion)
    const desiredName =
      args.desiredName === null ? null : normalizeHiveRuntimeDisplayName(args.desiredName)
    return this.serialized(async () => {
      const current = await this.read()
      const task: PendingRuntimeDisplayName = {
        ...args.scope,
        runtimeRecordId: args.runtimeRecordId,
        desiredName,
        expectedCloudDisplayNameVersion: args.expectedCloudDisplayNameVersion,
        expectedResourceVersion: args.expectedResourceVersion,
        revision: current.nextRevision,
        dormant: false,
        confirmed: false,
        confirmedCloudDisplayNameVersion: null
      }
      const tasks = current.tasks.filter(
        (existing) =>
          !(
            existing.runtimeRecordId === task.runtimeRecordId &&
            taskMatchesScope(existing, args.scope)
          )
      )
      const replacesExisting = tasks.length !== current.tasks.length
      const scopeTaskCount = current.tasks.filter((existing) =>
        taskMatchesScope(existing, args.scope)
      ).length
      const scopeExists = scopeTaskCount > 0
      if (
        !scopeExists &&
        countPendingScopes(current.tasks) >= MAXIMUM_PENDING_DISPLAY_NAME_SCOPES
      ) {
        throw new Error('runtime_display_name_pending_scope_capacity')
      }
      if (!replacesExisting && scopeTaskCount >= MAXIMUM_PENDING_DISPLAY_NAME_TASKS) {
        throw new Error('runtime_display_name_pending_capacity')
      }
      tasks.push(task)
      await this.write({ schemaVersion: 1, nextRevision: current.nextRevision + 1, tasks })
      return task
    })
  }

  removeIfCurrent(task: PendingRuntimeDisplayName): Promise<boolean> {
    return this.serialized(async () => {
      const current = await this.read()
      const tasks = current.tasks.filter((candidate) => !sameMutation(candidate, task))
      if (tasks.length === current.tasks.length) {
        return false
      }
      await this.write({ ...current, tasks })
      return true
    })
  }

  setDormantIfCurrent(task: PendingRuntimeDisplayName): Promise<boolean> {
    return this.updateIfCurrent(task, { dormant: true, confirmed: false })
  }

  markConfirmedIfCurrent(
    task: PendingRuntimeDisplayName,
    confirmedCloudDisplayNameVersion: number
  ): Promise<boolean> {
    assertPendingPositiveInteger(confirmedCloudDisplayNameVersion)
    return this.updateIfCurrent(task, {
      dormant: true,
      confirmed: true,
      confirmedCloudDisplayNameVersion
    })
  }

  applyRetryMutations(
    mutations: readonly PendingDisplayNameRetryMutation[]
  ): Promise<{ changed: boolean }> {
    for (const mutation of mutations) {
      if (mutation.kind === 'confirmed') {
        assertPendingPositiveInteger(mutation.confirmedCloudDisplayNameVersion)
      }
    }
    return this.serialized(async () => {
      if (mutations.length === 0) {
        return { changed: false }
      }
      const current = await this.read()
      const tasks = [...current.tasks]
      let mutated = false
      let changed = false
      for (const mutation of mutations) {
        const index = tasks.findIndex((candidate) => sameMutation(candidate, mutation.task))
        if (index === -1) {
          continue
        }
        mutated = true
        if (mutation.kind === 'remove') {
          tasks.splice(index, 1)
          changed = true
        } else if (mutation.kind === 'dormant') {
          tasks[index] = { ...tasks[index]!, dormant: true, confirmed: false }
        } else {
          tasks[index] = {
            ...tasks[index]!,
            dormant: true,
            confirmed: true,
            confirmedCloudDisplayNameVersion: mutation.confirmedCloudDisplayNameVersion
          }
          changed = true
        }
      }
      if (mutated) {
        await this.write({ ...current, tasks })
      }
      return { changed }
    })
  }

  async reconcileDirectory(
    scope: AccountRuntimeDirectoryScope,
    entries: readonly AccountRuntimeDirectoryEntry[]
  ): Promise<void> {
    const byId = new Map(entries.map((entry) => [entry.runtimeRecordId, entry]))
    await this.serialized(async () => {
      const current = await this.read()
      let changed = false
      const tasks = current.tasks.flatMap((task): PendingRuntimeDisplayName[] => {
        if (!taskMatchesScope(task, scope)) {
          return [task]
        }
        const entry = byId.get(task.runtimeRecordId)
        if (!entry) {
          changed = true
          return []
        }
        if ((entry.cloudDisplayName ?? null) === task.desiredName) {
          changed = true
          return []
        }
        if (task.confirmed && entry.resourceVersion !== task.expectedResourceVersion) {
          changed = true
          return []
        }
        if (entry.cloudDisplayNameVersion == null) {
          if (!task.dormant) {
            changed = true
            return [{ ...task, dormant: true }]
          }
          return [task]
        }
        if (task.confirmed) {
          if (
            task.confirmedCloudDisplayNameVersion != null &&
            entry.cloudDisplayNameVersion < task.confirmedCloudDisplayNameVersion
          ) {
            return [task]
          }
          changed = true
          return []
        }
        if (entry.resourceVersion !== task.expectedResourceVersion) {
          if (task.dormant) {
            changed = true
            return [{ ...task, dormant: false }]
          }
          return [task]
        }
        if (
          task.dormant ||
          task.expectedCloudDisplayNameVersion !== entry.cloudDisplayNameVersion
        ) {
          changed = true
          return [
            {
              ...task,
              dormant: false,
              confirmed: false,
              confirmedCloudDisplayNameVersion: null,
              expectedCloudDisplayNameVersion: entry.cloudDisplayNameVersion
            }
          ]
        }
        return [task]
      })
      if (changed) {
        await this.write({ ...current, tasks })
      }
    })
  }

  private updateIfCurrent(
    task: PendingRuntimeDisplayName,
    patch: Partial<
      Pick<
        PendingRuntimeDisplayName,
        | 'dormant'
        | 'confirmed'
        | 'confirmedCloudDisplayNameVersion'
        | 'expectedCloudDisplayNameVersion'
      >
    >
  ): Promise<boolean> {
    return this.serialized(async () => {
      const current = await this.read()
      let changed = false
      const tasks = current.tasks.map((candidate) => {
        if (!sameMutation(candidate, task)) {
          return candidate
        }
        changed = true
        return { ...candidate, ...patch }
      })
      if (changed) {
        await this.write({ ...current, tasks })
      }
      return changed
    })
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.catch(() => undefined)
    return result
  }

  private async read(): Promise<PendingDisplayNameState> {
    let raw: string | null
    try {
      raw = await this.storage.getItem(STORAGE_KEY)
    } catch {
      throw new Error('runtime_display_name_pending_read_failed')
    }
    if (raw === null) {
      return EMPTY_PENDING_DISPLAY_NAME_STATE
    }
    try {
      const value: unknown = JSON.parse(raw)
      if (isPendingDisplayNameState(value)) {
        return value
      }
    } catch {
      // Invalid JSON and a structurally invalid value are both corrupt persisted state.
    }
    throw new Error('runtime_display_name_pending_invalid')
  }

  private async write(state: PendingDisplayNameState): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

function taskMatchesScope(
  task: PendingRuntimeDisplayName,
  scope: AccountRuntimeDirectoryScope
): boolean {
  return task.authorityId === scope.authorityId && task.accountId === scope.accountId
}

function countPendingScopes(tasks: readonly PendingRuntimeDisplayName[]): number {
  return new Set(tasks.map((task) => `${task.authorityId}\u0000${task.accountId}`)).size
}

function sameMutation(left: PendingRuntimeDisplayName, right: PendingRuntimeDisplayName): boolean {
  return (
    left.revision === right.revision &&
    left.runtimeRecordId === right.runtimeRecordId &&
    left.authorityId === right.authorityId &&
    left.accountId === right.accountId
  )
}
