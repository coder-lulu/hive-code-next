import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { activateHiveRuntimeCloudPresence } from './hive-runtime-cloud-activation'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudConfig } from './hive-runtime-cloud-config'
import {
  sendHiveRuntimeCloudHeartbeat,
  type PendingHeartbeat
} from './hive-runtime-cloud-heartbeat'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import {
  ClaimPendingPresenceError,
  defaultPresenceDependencies,
  FatalPresenceError,
  isRetryablePresenceError,
  schedulePresenceRetry,
  type ActiveLease,
  type HiveRuntimeCloudPresenceState,
  type PresenceClient,
  type PresenceDependencies,
  type RuntimeSource
} from './hive-runtime-cloud-presence-support'
import type { HiveRuntimeCloudRegistrationState } from './hive-runtime-cloud-state-store'

const HEARTBEAT_INTERVAL_MS = 30_000
const STALE_OPERATION = Symbol('stale_operation')

export type { HiveRuntimeCloudPresenceState, PresenceDependencies }

export class HiveRuntimeCloudPresenceService {
  private readonly client: PresenceClient | null
  private state: HiveRuntimeCloudPresenceState
  private authorization: HiveRuntimeCloudAuthorization | null = null
  private runtimeReady = false
  private stopped = false
  private epoch = 0
  private bootId: string
  private timer: NodeJS.Timeout | undefined
  private abortController: AbortController | null = null
  private inFlight: Promise<void> | null = null
  private lease: ActiveLease | null = null
  private pendingHeartbeat: PendingHeartbeat | null = null
  private retryAttempt = 0

  constructor(
    private readonly config: HiveRuntimeCloudConfig,
    private readonly userDataPath: string,
    private readonly runtimeSource: RuntimeSource,
    private readonly dependencies: PresenceDependencies = defaultPresenceDependencies
  ) {
    this.state = config.enabled ? 'SIGNED_OUT' : 'DISABLED'
    this.client = config.enabled ? dependencies.createClient(config.apiBaseUrl) : null
    this.bootId = dependencies.randomUuid()
  }

  getState(): HiveRuntimeCloudPresenceState {
    return this.state
  }

  setAuthorization(authorization: HiveRuntimeCloudAuthorization | null): void {
    if (!this.config.enabled || this.stopped) {
      return
    }
    if (!authorization || authorization.sessionExpiresAt <= this.dependencies.now()) {
      this.authorization = null
      this.fence('SIGNED_OUT')
      return
    }
    const sameOwner =
      this.authorization?.accountId === authorization.accountId &&
      this.authorization.authorityId === authorization.authorityId
    this.authorization = authorization
    if (sameOwner && (this.state === 'ONLINE' || this.state === 'LEASED')) {
      return
    }
    this.resetWork()
    this.lease = null
    this.pendingHeartbeat = null
    this.state = this.runtimeReady ? 'ACTIVATING' : 'WAITING_RUNTIME'
    if (this.runtimeReady) {
      this.startActivation()
    }
  }

  setRuntimeReady(ready: boolean): void {
    if (!this.config.enabled || this.stopped || this.runtimeReady === ready) {
      return
    }
    this.runtimeReady = ready
    if (!ready) {
      this.resetWork()
      this.lease = null
      this.pendingHeartbeat = null
      this.state = this.authorization ? 'WAITING_RUNTIME' : 'SIGNED_OUT'
      return
    }
    if (this.authorization) {
      this.state = 'ACTIVATING'
      this.startActivation()
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    const pending = this.inFlight
    this.resetWork()
    this.authorization = null
    this.lease = null
    this.pendingHeartbeat = null
    this.state = this.config.enabled ? 'STOPPED' : 'DISABLED'
    await pending?.catch(() => undefined)
  }

  private fence(state: 'SIGNED_OUT' | 'FENCED'): void {
    this.resetWork()
    this.lease = null
    this.pendingHeartbeat = null
    this.state = state
  }

  private resetWork(): void {
    this.epoch += 1
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.abortController?.abort()
    this.abortController = null
    this.retryAttempt = 0
  }

  private assertCurrent(epoch: number): void {
    if (this.stopped || epoch !== this.epoch) {
      throw STALE_OPERATION
    }
    if (!this.authorization || this.authorization.sessionExpiresAt <= this.dependencies.now()) {
      this.authorization = null
      this.fence('SIGNED_OUT')
      throw STALE_OPERATION
    }
  }

  private startActivation(): void {
    const epoch = this.epoch
    const controller = new AbortController()
    this.abortController = controller
    this.inFlight = this.activate(epoch, controller.signal)
      .catch((error: unknown) => this.handleActivationFailure(epoch, error))
      .finally(() => {
        if (this.epoch === epoch) {
          this.abortController = null
          this.inFlight = null
        }
      })
  }

  private async activate(epoch: number, signal: AbortSignal): Promise<void> {
    this.assertCurrent(epoch)
    if (!this.client) {
      throw new FatalPresenceError('client_unavailable')
    }
    const loadedIdentity = this.dependencies.loadIdentity(this.userDataPath)
    if (loadedIdentity.status !== 'ok') {
      throw new FatalPresenceError('identity_unavailable')
    }
    const identity = loadedIdentity.identity
    const stored = this.dependencies.readState(this.userDataPath)
    if (stored.status === 'unavailable' || stored.status === 'unreadable') {
      throw new FatalPresenceError('registration_state_unavailable')
    }
    const authorization = this.authorization
    if (!authorization) {
      throw STALE_OPERATION
    }
    const result = await activateHiveRuntimeCloudPresence({
      client: this.client,
      authorization,
      identity,
      stored: stored.status === 'ok' ? stored.value : null,
      bootId: this.bootId,
      report: this.runtimeSource.getReport(),
      signal,
      now: this.dependencies.now,
      randomUuid: this.dependencies.randomUuid,
      assertCurrent: () => this.assertCurrent(epoch),
      saveState: (state) => this.saveState(state)
    })
    if (result.status === 'CLAIM_PENDING') {
      this.state = 'CLAIM_PENDING'
      return
    }
    this.bootId = result.bootId
    this.lease = result.lease
    this.pendingHeartbeat = null
    this.state = 'LEASED'
    this.retryAttempt = 0
    try {
      await this.sendHeartbeat(epoch, result.identity, signal)
    } catch (error) {
      this.handleHeartbeatFailure(epoch, result.identity, error)
    }
  }

  private saveState(state: HiveRuntimeCloudRegistrationState): void {
    if (!this.dependencies.saveState(this.userDataPath, state)) {
      throw new FatalPresenceError('registration_state_write_failed')
    }
  }

  private async sendHeartbeat(
    epoch: number,
    identity: HiveRuntimeCloudIdentity,
    signal: AbortSignal
  ): Promise<void> {
    this.assertCurrent(epoch)
    if (!this.client || !this.lease) {
      throw new FatalPresenceError('lease_unavailable')
    }
    const authorization = this.authorization
    if (!authorization) {
      throw STALE_OPERATION
    }
    this.lease.nextHeartbeatSeq = await sendHiveRuntimeCloudHeartbeat({
      client: this.client,
      identity,
      authorization,
      lease: this.lease,
      pending: this.pendingHeartbeat,
      report: this.runtimeSource.getReport(),
      now: this.dependencies.now,
      signal,
      onPrepared: (pending) => {
        this.pendingHeartbeat = pending
      },
      assertCurrent: () => this.assertCurrent(epoch)
    })
    this.pendingHeartbeat = null
    this.retryAttempt = 0
    this.state = 'ONLINE'
    this.scheduleHeartbeat(epoch, identity)
  }

  private scheduleHeartbeat(epoch: number, identity: HiveRuntimeCloudIdentity): void {
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.epoch !== epoch || this.stopped) {
        return
      }
      this.startHeartbeat(epoch, identity)
    }, HEARTBEAT_INTERVAL_MS)
    this.timer.unref?.()
  }

  private startHeartbeat(epoch: number, identity: HiveRuntimeCloudIdentity): void {
    const controller = new AbortController()
    this.abortController = controller
    this.inFlight = this.sendHeartbeat(epoch, identity, controller.signal)
      .catch((error: unknown) => this.handleHeartbeatFailure(epoch, identity, error))
      .finally(() => {
        if (this.epoch === epoch) {
          this.abortController = null
          this.inFlight = null
        }
      })
  }

  private handleActivationFailure(epoch: number, error: unknown): void {
    if (error === STALE_OPERATION || epoch !== this.epoch || this.stopped) {
      return
    }
    if (error instanceof ClaimPendingPresenceError) {
      this.state = 'CLAIM_PENDING'
      return
    }
    if (error instanceof FatalPresenceError || !isRetryablePresenceError(error)) {
      this.fence('FENCED')
      return
    }
    this.state = 'OFFLINE_RETRY'
    this.scheduleRetry(() => this.startActivation())
  }

  private handleHeartbeatFailure(
    epoch: number,
    identity: HiveRuntimeCloudIdentity,
    error: unknown
  ): void {
    if (error === STALE_OPERATION || epoch !== this.epoch || this.stopped) {
      return
    }
    if (
      error instanceof HiveRuntimeCloudRequestError &&
      (error.status === 409 || error.status === 410)
    ) {
      this.lease = null
      this.pendingHeartbeat = null
      this.state = 'OFFLINE_RETRY'
      this.scheduleRetry(() => this.startActivation())
      return
    }
    if (error instanceof FatalPresenceError || !isRetryablePresenceError(error)) {
      this.fence('FENCED')
      return
    }
    this.state = 'OFFLINE_RETRY'
    this.scheduleRetry(() => this.startHeartbeat(epoch, identity))
  }

  private scheduleRetry(action: () => void, explicitDelay?: number): void {
    this.timer = schedulePresenceRetry(
      this.retryAttempt++,
      this.dependencies.random,
      () => !this.stopped && this.authorization !== null && this.runtimeReady,
      action,
      explicitDelay
    )
  }
}
