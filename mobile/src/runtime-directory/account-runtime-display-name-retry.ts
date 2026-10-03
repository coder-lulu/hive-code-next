import { MobileApiError } from '../auth/mobile-sms-client'
import type {
  AccountRuntimeDirectoryEntry,
  AccountRuntimeDirectoryScope
} from './account-runtime-directory-types'
import {
  AccountRuntimeDisplayNamePendingStore,
  type PendingDisplayNameRetryMutation,
  type PendingRuntimeDisplayName
} from './account-runtime-display-name-pending'

type RetryDependencies = Readonly<{
  store: AccountRuntimeDisplayNamePendingStore
  scope: AccountRuntimeDirectoryScope
  currentScope: () => AccountRuntimeDirectoryScope | null
  patch: (
    runtimeRecordId: string,
    desiredName: string | null,
    expectedCloudDisplayNameVersion: number
  ) => Promise<{ readonly cloudDisplayNameVersion: number }>
  refetch: (runtimeRecordId: string) => Promise<AccountRuntimeDirectoryEntry>
}>

export type PendingDisplayNameRetryResult = Readonly<{
  changed: boolean
  directoryRefreshRequired: boolean
}>

type RetryFlight = {
  rerun: boolean
  promise: Promise<PendingDisplayNameRetryResult>
}

const retryFlights = new WeakMap<AccountRuntimeDisplayNamePendingStore, Map<string, RetryFlight>>()

export function retryPendingRuntimeDisplayNames(
  dependencies: RetryDependencies
): Promise<PendingDisplayNameRetryResult> {
  let storeFlights = retryFlights.get(dependencies.store)
  if (!storeFlights) {
    storeFlights = new Map()
    retryFlights.set(dependencies.store, storeFlights)
  }
  const key = `${dependencies.scope.authorityId}\u0000${dependencies.scope.accountId}`
  const existing = storeFlights.get(key)
  if (existing) {
    // An enqueue while a request is in flight must not wait for a later
    // foreground/timer event. One trailing pass observes the latest revision.
    existing.rerun = true
    return existing.promise
  }
  const flight: RetryFlight = { rerun: false, promise: Promise.resolve(emptyResult()) }
  flight.promise = runFlight(dependencies, flight).finally(() => storeFlights!.delete(key))
  storeFlights.set(key, flight)
  return flight.promise
}

async function runFlight(
  dependencies: RetryDependencies,
  flight: RetryFlight
): Promise<PendingDisplayNameRetryResult> {
  let aggregate = emptyResult()
  do {
    flight.rerun = false
    aggregate = mergeResults(aggregate, await runRetryPass(dependencies))
  } while (flight.rerun && scopeEquals(dependencies.currentScope(), dependencies.scope))
  return aggregate
}

async function runRetryPass(
  dependencies: RetryDependencies
): Promise<PendingDisplayNameRetryResult> {
  let changed = false
  let directoryRefreshRequired = false
  const mutations: PendingDisplayNameRetryMutation[] = []
  const tasks = await dependencies.store.loadScope(dependencies.scope)
  for (const snapshot of tasks) {
    if (snapshot.dormant || !scopeEquals(dependencies.currentScope(), dependencies.scope)) {
      continue
    }
    const task = await dependencies.store.loadTask(dependencies.scope, snapshot.runtimeRecordId)
    if (!task || task.revision !== snapshot.revision || task.dormant) {
      continue
    }
    try {
      const response = await assertScopedPatch(
        dependencies,
        task,
        task.expectedCloudDisplayNameVersion
      )
      mutations.push({
        kind: 'confirmed',
        task,
        confirmedCloudDisplayNameVersion: response.cloudDisplayNameVersion
      })
      continue
    } catch (failure) {
      if (!(failure instanceof MobileApiError) || failure.status !== 409) {
        if (failure instanceof MobileApiError && failure.status === 404) {
          mutations.push({ kind: 'dormant', task })
          directoryRefreshRequired = true
        }
        continue
      }
    }

    try {
      assertCurrentScope(dependencies)
      const current = await dependencies.refetch(task.runtimeRecordId)
      assertCurrentScope(dependencies)
      const currentTask = await dependencies.store.loadTask(
        dependencies.scope,
        task.runtimeRecordId
      )
      if (!currentTask || currentTask.revision !== task.revision || currentTask.dormant) {
        continue
      }
      if (current.resourceVersion !== currentTask.expectedResourceVersion) {
        mutations.push({ kind: 'remove', task: currentTask })
        continue
      }
      if (current.cloudDisplayNameVersion == null) {
        mutations.push({ kind: 'dormant', task: currentTask })
        directoryRefreshRequired = true
        continue
      }
      const confirmedVersion =
        (current.cloudDisplayName ?? null) === currentTask.desiredName
          ? current.cloudDisplayNameVersion
          : (await assertScopedPatch(dependencies, currentTask, current.cloudDisplayNameVersion))
              .cloudDisplayNameVersion
      mutations.push({
        kind: 'confirmed',
        task: currentTask,
        confirmedCloudDisplayNameVersion: confirmedVersion
      })
    } catch (failure) {
      if (failure instanceof MobileApiError && failure.status === 404) {
        mutations.push({ kind: 'dormant', task })
        directoryRefreshRequired = true
      }
    }
  }
  changed = (await dependencies.store.applyRetryMutations(mutations)).changed
  return { changed, directoryRefreshRequired }
}

async function assertScopedPatch(
  dependencies: RetryDependencies,
  task: PendingRuntimeDisplayName,
  expectedVersion: number
): Promise<{ readonly cloudDisplayNameVersion: number }> {
  assertCurrentScope(dependencies)
  const response = await dependencies.patch(task.runtimeRecordId, task.desiredName, expectedVersion)
  assertCurrentScope(dependencies)
  return response
}

function assertCurrentScope(dependencies: RetryDependencies): void {
  if (!scopeEquals(dependencies.currentScope(), dependencies.scope)) {
    throw new Error('mobile_session_required')
  }
}

function scopeEquals(
  left: AccountRuntimeDirectoryScope | null,
  right: AccountRuntimeDirectoryScope
): boolean {
  return left?.authorityId === right.authorityId && left.accountId === right.accountId
}

function emptyResult(): PendingDisplayNameRetryResult {
  return { changed: false, directoryRefreshRequired: false }
}

function mergeResults(
  left: PendingDisplayNameRetryResult,
  right: PendingDisplayNameRetryResult
): PendingDisplayNameRetryResult {
  return {
    changed: left.changed || right.changed,
    directoryRefreshRequired: left.directoryRefreshRequired || right.directoryRefreshRequired
  }
}
