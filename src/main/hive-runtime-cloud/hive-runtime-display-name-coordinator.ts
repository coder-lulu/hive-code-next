import { normalizeHiveRuntimeDisplayName } from '../../shared/hive-runtime-display-name'
import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveRuntimePendingDisplayName,
  HiveRuntimeDisplayNameDiscardRequest
} from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  desktopPendingTaskMatchesAuthorization,
  MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES,
  type DesktopPendingDisplayNameState,
  type DesktopPendingRuntimeDisplayName,
  type HiveRuntimeDisplayNamePendingStore
} from './hive-runtime-display-name-pending-store'
import { reconcileDesktopRuntimeDisplayNames } from './hive-runtime-display-name-reconcile'
import {
  submitRuntimeDisplayNameTask,
  type RuntimeDisplayNameClient
} from './hive-runtime-display-name-submission'

export class HiveRuntimeDisplayNameCoordinator {
  private authorization: HiveRuntimeCloudAuthorization | null = null
  private state: DesktopPendingDisplayNameState
  private retryFlight: Promise<void> | null = null
  private retryTrailing = false
  private storageError: string | null = null

  constructor(
    private readonly store: Pick<HiveRuntimeDisplayNamePendingStore, 'load' | 'save'>,
    private readonly client: RuntimeDisplayNameClient,
    private readonly now: () => number,
    private readonly onChanged: () => void,
    private readonly requestDirectoryRefresh: () => void
  ) {
    this.state = store.load()
  }

  setAuthorization(authorization: HiveRuntimeCloudAuthorization | null, publish = true): void {
    this.authorization =
      authorization && authorization.sessionExpiresAt > this.now() ? authorization : null
    if (publish) {
      this.onChanged()
    }
    if (this.authorization) {
      void this.retry().catch(() => undefined)
    }
  }

  getStorageError(): string | null {
    return this.storageError
  }

  getPending(): readonly HiveRuntimePendingDisplayName[] {
    const authorization = this.authorization
    if (!authorization) {
      return []
    }
    return this.state.tasks
      .filter((task) => desktopPendingTaskMatchesAuthorization(task, authorization))
      .map(
        ({
          authorityId: _authority,
          accountId: _account,
          expectedResourceVersion: _resource,
          resumeStatus: _resume,
          ...task
        }) => task
      )
  }

  enqueue(args: {
    runtimeRecordId: string
    desiredName: string | null
    expectedOwnershipEpoch: number
    expectedCloudDisplayNameVersion: number
    expectedResourceVersion: number
    pendingRevision?: number
  }): void {
    const authorization = this.requireAuthorization()
    const desiredName =
      args.desiredName === null ? null : normalizeHiveRuntimeDisplayName(args.desiredName)
    assertPositiveInteger(args.expectedOwnershipEpoch)
    assertPositiveInteger(args.expectedCloudDisplayNameVersion)
    assertPositiveInteger(args.expectedResourceVersion)
    assertPositiveInteger(this.state.nextRevision + 1)
    const existing = this.state.tasks.find(
      (task) =>
        task.runtimeRecordId === args.runtimeRecordId &&
        desktopPendingTaskMatchesAuthorization(task, authorization)
    )
    if (
      existing?.status === 'SUBMITTING' ||
      (existing && existing.status !== 'QUEUED' && args.pendingRevision !== existing.revision) ||
      (args.pendingRevision != null && args.pendingRevision !== existing?.revision)
    ) {
      throw new Error('hive_runtime_display_name_draft_stale')
    }
    const scopeCount = this.state.tasks.filter((task) =>
      desktopPendingTaskMatchesAuthorization(task, authorization)
    ).length
    if (!existing && scopeCount >= MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES) {
      throw new Error('hive_runtime_display_name_pending_capacity')
    }
    const task: DesktopPendingRuntimeDisplayName = {
      authorityId: authorization.authorityId,
      accountId: authorization.accountId,
      runtimeRecordId: args.runtimeRecordId,
      desiredName,
      expectedOwnershipEpoch: args.expectedOwnershipEpoch,
      expectedCloudDisplayNameVersion: args.expectedCloudDisplayNameVersion,
      expectedResourceVersion: args.expectedResourceVersion,
      revision: this.state.nextRevision,
      status: 'QUEUED',
      errorCode:
        existing?.retryNotBefore != null && existing.retryNotBefore > this.now()
          ? 'RATE_LIMITED'
          : null,
      resumeStatus: null,
      latestCloudDisplayName: null,
      latestCloudDisplayNameVersion: null,
      confirmedCloudDisplayNameVersion: null,
      retryNotBefore: existing?.retryNotBefore ?? null
    }
    this.commit({
      schemaVersion: 2,
      nextRevision: this.state.nextRevision + 1,
      tasks: [...this.state.tasks.filter((candidate) => candidate !== existing), task]
    })
    void this.retry().catch(() => undefined)
  }

  discard(request: HiveRuntimeDisplayNameDiscardRequest): void {
    const authorization = this.requireAuthorization()
    const task = this.state.tasks.find(
      (candidate) =>
        candidate.runtimeRecordId === request.runtimeRecordId &&
        candidate.revision === request.revision &&
        desktopPendingTaskMatchesAuthorization(candidate, authorization)
    )
    if (!task || task.status === 'SUBMITTING') {
      throw new Error('hive_runtime_display_name_draft_stale')
    }
    this.replace(task, null)
  }

  reconcileDirectory(entries: readonly HiveAccountRuntimeDirectoryEntry[]): void {
    const authorization = this.authorization
    if (!authorization) {
      return
    }
    const tasks = reconcileDesktopRuntimeDisplayNames(this.state.tasks, authorization, entries)
    if (JSON.stringify(tasks) !== JSON.stringify(this.state.tasks)) {
      this.commit({ ...this.state, tasks })
    }
    void this.retry().catch(() => undefined)
  }

  retry(): Promise<void> {
    if (this.retryFlight) {
      this.retryTrailing = true
      return this.retryFlight
    }
    this.retryFlight = this.runRetryFlight().finally(() => {
      this.retryFlight = null
    })
    return this.retryFlight
  }

  private async runRetryFlight(): Promise<void> {
    do {
      this.retryTrailing = false
      await this.runRetryPass()
    } while (this.retryTrailing && this.authorization && !this.storageError)
  }

  private async runRetryPass(): Promise<void> {
    const authorization = this.authorization
    if (!authorization || authorization.sessionExpiresAt <= this.now() || this.storageError) {
      return
    }
    const tasks = this.state.tasks.filter(
      (task) =>
        desktopPendingTaskMatchesAuthorization(task, authorization) &&
        ['QUEUED', 'SUBMITTING', 'UNCONFIRMED', 'BLOCKED'].includes(task.status) &&
        task.expectedOwnershipEpoch != null &&
        !['OWNERSHIP_CHANGED', 'OWNERSHIP_UNVERIFIED', 'REQUEST_REJECTED'].includes(
          task.errorCode ?? ''
        )
    )
    let refresh = false
    for (const task of tasks) {
      const current = (): DesktopPendingRuntimeDisplayName | null =>
        this.authorizationMatches(authorization) ? this.currentTask(task) : null
      if (!current()) {
        continue
      }
      await submitRuntimeDisplayNameTask({
        client: this.client,
        authorization,
        now: this.now,
        current,
        replace: (replacement) => {
          if (current()) {
            this.replace(task, replacement)
          }
        }
      })
      const latest = current()
      refresh ||= latest?.status === 'CONFIRMED' || latest?.errorCode === 'OWNERSHIP_CHANGED'
    }
    if (refresh && this.authorizationMatches(authorization)) {
      this.requestDirectoryRefresh()
    }
  }

  private currentTask(
    snapshot: DesktopPendingRuntimeDisplayName
  ): DesktopPendingRuntimeDisplayName | null {
    return (
      this.state.tasks.find(
        (task) =>
          task.revision === snapshot.revision &&
          task.runtimeRecordId === snapshot.runtimeRecordId &&
          task.accountId === snapshot.accountId &&
          task.authorityId === snapshot.authorityId
      ) ?? null
    )
  }

  private replace(
    task: DesktopPendingRuntimeDisplayName,
    replacement: DesktopPendingRuntimeDisplayName | null
  ): void {
    const current = this.currentTask(task)
    if (!current) {
      return
    }
    if (replacement && JSON.stringify(replacement) === JSON.stringify(current)) {
      return
    }
    this.commit({
      ...this.state,
      tasks: this.state.tasks.flatMap((candidate) =>
        candidate === current ? (replacement ? [replacement] : []) : [candidate]
      )
    })
  }

  private commit(state: DesktopPendingDisplayNameState): void {
    try {
      this.store.save(state)
    } catch {
      this.storageError = 'PENDING_STORE_UNAVAILABLE'
      this.onChanged()
      throw new Error('hive_runtime_display_name_pending_persist_failed')
    }
    this.state = state
    this.storageError = null
    this.onChanged()
  }

  private requireAuthorization(): HiveRuntimeCloudAuthorization {
    const authorization = this.authorization
    if (!authorization || authorization.sessionExpiresAt <= this.now()) {
      throw new Error('hive_runtime_display_name_signed_out')
    }
    if (this.storageError) {
      throw new Error('hive_runtime_display_name_pending_persist_failed')
    }
    return authorization
  }

  private authorizationMatches(expected: HiveRuntimeCloudAuthorization): boolean {
    const current = this.authorization
    return (
      current?.authorityId === expected.authorityId &&
      current.accountId === expected.accountId &&
      current.sessionGeneration === expected.sessionGeneration &&
      current.sessionExpiresAt > this.now()
    )
  }
}

function assertPositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('hive_runtime_display_name_version_invalid')
  }
}
