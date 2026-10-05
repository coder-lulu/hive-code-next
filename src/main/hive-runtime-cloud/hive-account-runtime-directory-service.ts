import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  type HiveAccountRuntimeDirectoryState,
  type HiveRuntimeDisplayNameUpdateRequest,
  type HiveRuntimeDisplayNameDiscardRequest
} from '../../shared/hive-runtime-cloud'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudConfig } from './hive-runtime-cloud-config'
import {
  createHiveAccountRuntimeConnectionMaterial,
  HiveAccountRuntimeConnectionUnavailableError,
  type HiveAccountRuntimeConnectionMaterial
} from './hive-account-runtime-connection-material'
import type { HiveRuntimeDisplayNameCoordinator } from './hive-runtime-display-name-coordinator'
import { createHiveRuntimeDisplayNameCoordinator } from './hive-runtime-display-name-coordinator-factory'
import {
  hiveAccountRuntimeDirectoryErrorCode,
  loadHiveAccountRuntimeDirectory,
  defaultHiveAccountRuntimeDirectoryDependencies,
  type HiveAccountRuntimeDirectoryClient,
  type HiveAccountRuntimeDirectoryDependencies
} from './hive-account-runtime-directory-refresh'
import { publishHiveAccountRuntimeDirectory } from './hive-account-runtime-directory-publication'
import {
  enqueueAccountRuntimeDisplayName,
  projectAccountRuntimeDisplayNameState
} from './hive-account-runtime-display-name-actions'

const DIRECTORY_REFRESH_INTERVAL_MS = 30_000

export class HiveAccountRuntimeDirectoryService {
  private readonly client: HiveAccountRuntimeDirectoryClient | null
  private readonly listeners = new Set<(state: HiveAccountRuntimeDirectoryState) => void>()
  private authorization: HiveRuntimeCloudAuthorization | null = null
  private state: HiveAccountRuntimeDirectoryState
  private controller: AbortController | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private epoch = 0
  private stopped = false
  private refreshFlight: Promise<void> | null = null
  private readonly displayNames: HiveRuntimeDisplayNameCoordinator | null

  constructor(
    config: HiveRuntimeCloudConfig,
    private readonly dependencies: HiveAccountRuntimeDirectoryDependencies = defaultHiveAccountRuntimeDirectoryDependencies,
    userDataPath?: string
  ) {
    this.client = config.enabled ? dependencies.createClient(config.apiBaseUrl) : null
    this.state = config.enabled
      ? EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY
      : { ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY, status: 'DISABLED' }
    this.displayNames = createHiveRuntimeDisplayNameCoordinator({
      client: this.client,
      userDataPath,
      now: dependencies.now,
      onChanged: () => this.setState(this.state),
      requestDirectoryRefresh: () => void this.refresh()
    })
  }

  getState(): HiveAccountRuntimeDirectoryState {
    return this.state
  }

  getConnectionScope(): string | null {
    const auth = this.authorization
    return auth && auth.sessionExpiresAt > this.dependencies.now()
      ? JSON.stringify([auth.authorityId, auth.accountId, auth.sessionGeneration])
      : null
  }

  subscribe(listener: (state: HiveAccountRuntimeDirectoryState) => void): () => void {
    this.listeners.add(listener)
    publishHiveAccountRuntimeDirectory(new Set([listener]), this.state)
    return () => this.listeners.delete(listener)
  }

  setAuthorization(authorization: HiveRuntimeCloudAuthorization | null): void {
    if (!this.client || this.stopped) {
      return
    }
    const previousAuthorization = this.authorization
    this.cancelRequest()
    if (!authorization || authorization.sessionExpiresAt <= this.dependencies.now()) {
      this.authorization = null
      this.displayNames?.setAuthorization(null, false)
      this.setState(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY)
      return
    }
    const retainItems =
      this.state.accountId === authorization.accountId &&
      previousAuthorization?.authorityId === authorization.authorityId
    this.authorization = authorization
    this.displayNames?.setAuthorization(authorization, false)
    this.setState({
      status: 'LOADING',
      accountId: authorization.accountId,
      sessionGeneration: authorization.sessionGeneration,
      items: retainItems ? this.state.items : [],
      lastSyncedAt: retainItems ? this.state.lastSyncedAt : null,
      errorCode: null
    })
    void this.startRefresh(authorization)
  }

  async updateDisplayName(
    request: HiveRuntimeDisplayNameUpdateRequest
  ): Promise<HiveAccountRuntimeDirectoryState> {
    enqueueAccountRuntimeDisplayName(this.displayNames, this.authorization, this.state, request)
    return this.state
  }

  discardDisplayName(
    request: HiveRuntimeDisplayNameDiscardRequest
  ): HiveAccountRuntimeDirectoryState {
    if (!this.displayNames) {
      throw new Error('hive_runtime_display_name_unavailable')
    }
    this.displayNames.discard(request)
    return this.state
  }

  async refresh(): Promise<HiveAccountRuntimeDirectoryState> {
    const authorization = this.authorization
    if (!authorization || !this.client || this.stopped) {
      return this.state
    }
    if (authorization.sessionExpiresAt <= this.dependencies.now()) {
      this.cancelRequest()
      this.authorization = null
      this.displayNames?.setAuthorization(null, false)
      this.setState(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY)
      return this.state
    }
    if (this.refreshFlight && this.controller && !this.controller.signal.aborted) {
      await this.refreshFlight
      return this.state
    }
    this.cancelRequest()
    this.setState({
      ...this.state,
      status: this.state.items.length > 0 ? 'STALE' : 'LOADING',
      errorCode: null
    })
    await this.startRefresh(authorization)
    return this.state
  }

  async createConnection(
    runtimeRecordId: string,
    expectedResourceVersion: number,
    signal?: AbortSignal
  ): Promise<HiveAccountRuntimeConnectionMaterial> {
    return createHiveAccountRuntimeConnectionMaterial({
      runtimeRecordId,
      expectedResourceVersion,
      signal,
      authorization: this.authorization,
      client: this.client,
      findEntry: (id) => this.state.items.find((entry) => entry.runtimeRecordId === id),
      now: this.dependencies.now,
      assertAuthorizationCurrent: (authorization) => this.assertCurrentAuthorization(authorization)
    })
  }

  stop(): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.authorization = null
    this.displayNames?.setAuthorization(null, false)
    this.cancelRequest()
    this.listeners.clear()
  }

  private startRefresh(authorization: HiveRuntimeCloudAuthorization): Promise<void> {
    const flight = this.runRefresh(authorization)
    this.refreshFlight = flight
    void flight.finally(() => {
      if (this.refreshFlight === flight) {
        this.refreshFlight = null
      }
    })
    return flight
  }

  private async runRefresh(authorization: HiveRuntimeCloudAuthorization): Promise<void> {
    if (!this.client) {
      return
    }
    const epoch = this.epoch
    const controller = new AbortController()
    this.controller = controller
    try {
      const items = await loadHiveAccountRuntimeDirectory({
        client: this.client,
        accessToken: authorization.accessToken,
        signal: controller.signal,
        assertCurrent: () => this.assertCurrent(epoch, authorization)
      })
      this.assertCurrent(epoch, authorization)
      try {
        this.displayNames?.reconcileDirectory(items)
      } catch {
        /* Directory freshness must not depend on local pending-name storage. */
      }
      this.setState({
        status: 'READY',
        accountId: authorization.accountId,
        sessionGeneration: authorization.sessionGeneration,
        items,
        lastSyncedAt: this.dependencies.now(),
        errorCode: null
      })
    } catch (error) {
      if (controller.signal.aborted || epoch !== this.epoch || this.stopped) {
        return
      }
      const credentialRejected =
        error instanceof HiveRuntimeCloudRequestError && error.status === 401
      if (credentialRejected) {
        this.authorization = null
        this.displayNames?.setAuthorization(null, false)
        this.cancelRequest()
        this.setState({
          status: 'ERROR',
          accountId: authorization.accountId,
          sessionGeneration: authorization.sessionGeneration,
          items: [],
          lastSyncedAt: null,
          errorCode: 'SESSION_REJECTED'
        })
        return
      }
      this.setState({
        ...this.state,
        status: this.state.items.length > 0 ? 'STALE' : 'ERROR',
        errorCode: hiveAccountRuntimeDirectoryErrorCode(error)
      })
    } finally {
      if (this.controller === controller) {
        this.controller = null
        this.scheduleRefresh(authorization)
      }
    }
  }

  private assertCurrent(epoch: number, authorization: HiveRuntimeCloudAuthorization): void {
    if (
      this.stopped ||
      epoch !== this.epoch ||
      this.authorization?.accountId !== authorization.accountId ||
      this.authorization.authorityId !== authorization.authorityId ||
      this.authorization.sessionGeneration !== authorization.sessionGeneration ||
      this.authorization.sessionExpiresAt <= this.dependencies.now()
    ) {
      throw new Error('hive_runtime_cloud_directory_stale')
    }
  }

  private assertCurrentAuthorization(authorization: HiveRuntimeCloudAuthorization): void {
    const current = this.authorization
    if (
      this.stopped ||
      current?.accountId !== authorization.accountId ||
      current.authorityId !== authorization.authorityId ||
      current.sessionGeneration !== authorization.sessionGeneration ||
      current.sessionExpiresAt <= this.dependencies.now()
    ) {
      throw new HiveAccountRuntimeConnectionUnavailableError('SIGNED_OUT')
    }
  }

  private cancelRequest(): void {
    this.epoch += 1
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    this.controller?.abort()
    this.controller = null
  }

  private scheduleRefresh(authorization: HiveRuntimeCloudAuthorization): void {
    if (
      this.stopped ||
      this.authorization?.accountId !== authorization.accountId ||
      this.authorization.authorityId !== authorization.authorityId ||
      this.authorization.sessionGeneration !== authorization.sessionGeneration
    ) {
      return
    }
    const remainingSessionMs = authorization.sessionExpiresAt - this.dependencies.now()
    if (remainingSessionMs <= 0) {
      this.authorization = null
      this.displayNames?.setAuthorization(null, false)
      this.setState(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY)
      return
    }
    this.refreshTimer = setTimeout(
      () => {
        this.refreshTimer = null
        void this.refresh()
      },
      Math.min(DIRECTORY_REFRESH_INTERVAL_MS, remainingSessionMs)
    )
    this.refreshTimer.unref?.()
  }

  private setState(state: HiveAccountRuntimeDirectoryState): void {
    this.state = projectAccountRuntimeDisplayNameState(
      state,
      this.displayNames,
      Boolean(this.client?.updateOwnedRuntimeDisplayName)
    )
    publishHiveAccountRuntimeDirectory(this.listeners, this.state)
  }
}
