/* eslint-disable max-lines -- Why: authorization fencing, retry serialization, and
   conflict reconciliation form one coordinator state machine. */
import { normalizeHiveRuntimeDisplayName } from '../../shared/hive-runtime-display-name'
import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveRuntimePendingDisplayName
} from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveRuntimeCloudAccountClient } from './hive-runtime-cloud-account-client'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-http-client'
import {
  desktopPendingTaskMatchesAuthorization,
  MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES,
  type DesktopPendingDisplayNameState,
  type DesktopPendingRuntimeDisplayName,
  type HiveRuntimeDisplayNamePendingStore
} from './hive-runtime-display-name-pending-store'
import { reconcileDesktopRuntimeDisplayNames } from './hive-runtime-display-name-reconcile'

type DisplayNameClient = Pick<
  HiveRuntimeCloudAccountClient,
  'getOwnedRuntime' | 'updateOwnedRuntimeDisplayName'
>

export class HiveRuntimeDisplayNameCoordinator {
  private authorization: HiveRuntimeCloudAuthorization | null = null
  private state: DesktopPendingDisplayNameState
  private retryFlight: Promise<void> | null = null
  private retryTrailing = false

  constructor(
    private readonly store: Pick<HiveRuntimeDisplayNamePendingStore, 'load' | 'save'>,
    private readonly client: DisplayNameClient,
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

  getPending(): readonly HiveRuntimePendingDisplayName[] {
    const authorization = this.authorization
    if (!authorization) {
      return []
    }
    return this.state.tasks
      .filter((task) => desktopPendingTaskMatchesAuthorization(task, authorization))
      .map((task) => ({
        runtimeRecordId: task.runtimeRecordId,
        desiredName: task.desiredName,
        revision: task.revision,
        confirmed: task.confirmed
      }))
  }

  enqueue(args: {
    runtimeRecordId: string
    desiredName: string | null
    expectedCloudDisplayNameVersion: number
    expectedResourceVersion: number
  }): void {
    const authorization = this.requireAuthorization()
    const desiredName =
      args.desiredName === null ? null : normalizeHiveRuntimeDisplayName(args.desiredName)
    assertPositiveInteger(args.expectedCloudDisplayNameVersion)
    assertPositiveInteger(args.expectedResourceVersion)
    const task: DesktopPendingRuntimeDisplayName = {
      authorityId: authorization.authorityId,
      accountId: authorization.accountId,
      runtimeRecordId: args.runtimeRecordId,
      desiredName,
      expectedCloudDisplayNameVersion: args.expectedCloudDisplayNameVersion,
      expectedResourceVersion: args.expectedResourceVersion,
      revision: this.state.nextRevision,
      dormant: false,
      confirmed: false,
      confirmedCloudDisplayNameVersion: null
    }
    const replacesExisting = this.state.tasks.some(
      (candidate) =>
        candidate.runtimeRecordId === task.runtimeRecordId &&
        desktopPendingTaskMatchesAuthorization(candidate, authorization)
    )
    const scopeTaskCount = this.state.tasks.filter((candidate) =>
      desktopPendingTaskMatchesAuthorization(candidate, authorization)
    ).length
    if (!replacesExisting && scopeTaskCount >= MAXIMUM_DESKTOP_PENDING_DISPLAY_NAMES) {
      throw new Error('hive_runtime_display_name_pending_capacity')
    }
    const tasks = this.state.tasks.filter(
      (candidate) =>
        !(
          candidate.runtimeRecordId === task.runtimeRecordId &&
          desktopPendingTaskMatchesAuthorization(candidate, authorization)
        )
    )
    tasks.push(task)
    this.commit({ schemaVersion: 1, nextRevision: this.state.nextRevision + 1, tasks })
    void this.retry().catch(() => undefined)
  }

  reconcileDirectory(entries: readonly HiveAccountRuntimeDirectoryEntry[]): void {
    const authorization = this.authorization
    if (!authorization) {
      return
    }
    const tasks = reconcileDesktopRuntimeDisplayNames(this.state.tasks, authorization, entries)
    if (!sameTasks(tasks, this.state.tasks)) {
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
    } while (this.retryTrailing && this.authorization)
  }

  private async runRetryPass(): Promise<void> {
    const authorization = this.authorization
    if (!authorization || authorization.sessionExpiresAt <= this.now()) {
      return
    }
    const tasks = this.state.tasks.filter(
      (task) => !task.dormant && desktopPendingTaskMatchesAuthorization(task, authorization)
    )
    let directoryRefreshRequired = false
    for (const snapshot of tasks) {
      const task = this.currentTask(snapshot)
      if (!task || !this.authorizationMatches(authorization)) {
        continue
      }
      try {
        const response = await this.client.updateOwnedRuntimeDisplayName(
          task.runtimeRecordId,
          task.desiredName,
          task.expectedCloudDisplayNameVersion,
          authorization.accessToken
        )
        if (this.authorizationMatches(authorization)) {
          this.markConfirmed(task, response.cloudDisplayNameVersion)
          directoryRefreshRequired = true
        }
        continue
      } catch (failure) {
        if (!(failure instanceof HiveRuntimeCloudRequestError) || failure.status !== 409) {
          if (failure instanceof HiveRuntimeCloudRequestError && failure.status === 404) {
            this.markDormant(task)
            directoryRefreshRequired = true
          }
          continue
        }
      }
      directoryRefreshRequired =
        (await this.resolveConflict(task, authorization)) || directoryRefreshRequired
    }
    if (directoryRefreshRequired && this.authorizationMatches(authorization)) {
      this.requestDirectoryRefresh()
    }
  }

  private async resolveConflict(
    task: DesktopPendingRuntimeDisplayName,
    authorization: HiveRuntimeCloudAuthorization
  ): Promise<boolean> {
    if (!this.authorizationMatches(authorization) || !this.currentTask(task)) {
      return false
    }
    try {
      const entry = await this.client.getOwnedRuntime(
        task.runtimeRecordId,
        authorization.accessToken
      )
      const currentTask = this.currentTask(task)
      if (!this.authorizationMatches(authorization) || !currentTask) {
        return false
      }
      if (entry.resourceVersion !== currentTask.expectedResourceVersion) {
        this.remove(currentTask)
        return true
      }
      if (entry.cloudDisplayNameVersion == null) {
        this.markDormant(currentTask)
        return true
      }
      const confirmedVersion =
        (entry.cloudDisplayName ?? null) === currentTask.desiredName
          ? entry.cloudDisplayNameVersion
          : (
              await this.client.updateOwnedRuntimeDisplayName(
                currentTask.runtimeRecordId,
                currentTask.desiredName,
                entry.cloudDisplayNameVersion,
                authorization.accessToken
              )
            ).cloudDisplayNameVersion
      if (this.authorizationMatches(authorization)) {
        this.markConfirmed(currentTask, confirmedVersion)
        return true
      }
    } catch (failure) {
      if (
        failure instanceof HiveRuntimeCloudRequestError &&
        failure.status === 404 &&
        this.authorizationMatches(authorization)
      ) {
        this.markDormant(task)
        return true
      }
    }
    return false
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

  private markDormant(task: DesktopPendingRuntimeDisplayName): void {
    this.replace(task, { ...task, dormant: true, confirmed: false })
  }

  private markConfirmed(task: DesktopPendingRuntimeDisplayName, version: number): void {
    assertPositiveInteger(version)
    this.replace(task, {
      ...task,
      dormant: true,
      confirmed: true,
      confirmedCloudDisplayNameVersion: version
    })
  }

  private remove(task: DesktopPendingRuntimeDisplayName): void {
    this.replace(task, null)
  }

  private replace(
    task: DesktopPendingRuntimeDisplayName,
    replacement: DesktopPendingRuntimeDisplayName | null
  ): void {
    if (!this.currentTask(task)) {
      return
    }
    const tasks = this.state.tasks.flatMap((candidate) =>
      this.currentTaskMatches(candidate, task) ? (replacement ? [replacement] : []) : [candidate]
    )
    this.commit({ ...this.state, tasks })
  }

  private currentTaskMatches(
    left: DesktopPendingRuntimeDisplayName,
    right: DesktopPendingRuntimeDisplayName
  ): boolean {
    return (
      left.revision === right.revision &&
      left.runtimeRecordId === right.runtimeRecordId &&
      left.accountId === right.accountId &&
      left.authorityId === right.authorityId
    )
  }

  private commit(state: DesktopPendingDisplayNameState): void {
    this.store.save(state)
    this.state = state
    this.onChanged()
  }

  private requireAuthorization(): HiveRuntimeCloudAuthorization {
    const authorization = this.authorization
    if (!authorization || authorization.sessionExpiresAt <= this.now()) {
      throw new Error('hive_runtime_display_name_signed_out')
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

function sameTasks(
  left: readonly DesktopPendingRuntimeDisplayName[],
  right: readonly DesktopPendingRuntimeDisplayName[]
): boolean {
  return left.length === right.length && left.every((task, index) => task === right[index])
}
