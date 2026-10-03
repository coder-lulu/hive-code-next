import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  persistHiveRuntimeCloudRegistrationState,
  runHiveRuntimeCloudActivation
} from './hive-runtime-cloud-activation-runner'
import type { HiveRuntimeCloudConfig } from './hive-runtime-cloud-config'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import {
  defaultPresenceDependencies,
  FatalPresenceError,
  type ActiveLease,
  type HiveRuntimeCloudPresenceState,
  type PresenceClient,
  type PresenceDependencies,
  type RuntimeSource
} from './hive-runtime-cloud-presence-support'
import {
  HiveRuntimeCloudLeaseContextPublisher,
  type CurrentHiveRuntimeCloudLeaseContext,
  type HiveRuntimeCloudLeaseContextListener
} from './hive-runtime-cloud-lease-context'
import {
  handleHiveRuntimeCloudActivationFailure,
  handleHiveRuntimeCloudHeartbeatFailure
} from './hive-runtime-cloud-presence-failure'
import { migrateHiveRuntimeCloudPresenceAuthorization } from './hive-runtime-cloud-presence-authorization'
import { HiveRuntimeCloudPresenceScheduler } from './hive-runtime-cloud-presence-scheduling'
import { HiveRuntimeCloudPresenceRelay } from './hive-runtime-cloud-presence-relay'
import type { HiveRuntimeRelayHeartbeatContributor } from './relay-host/hive-runtime-relay-heartbeat-types'

const INITIAL_ACTIVATION_WINDOW_MS = 15_000
const STALE_OPERATION = Symbol('stale_operation')

export class HiveRuntimeCloudPresenceService {
  private readonly client: PresenceClient | null
  private state: HiveRuntimeCloudPresenceState
  private authorityId: string | null = null
  private runtimeReady = false
  private stopped = false
  private epoch = 0
  private bootId: string
  private abortController: AbortController | null = null
  private inFlight: Promise<void> | null = null
  private lease: ActiveLease | null = null
  private readonly leaseContext = new HiveRuntimeCloudLeaseContextPublisher()
  private readonly stateListeners = new Set<(state: HiveRuntimeCloudPresenceState) => void>()
  private readonly scheduler: HiveRuntimeCloudPresenceScheduler
  private readonly relayHeartbeat = new HiveRuntimeCloudPresenceRelay(() => {
    const context = this.getCurrentLeaseContext()
    if (this.inFlight || !context || this.stopped) {
      return false
    }
    this.scheduler.reset()
    this.startHeartbeat(this.epoch, context.identity)
    return true
  })

  constructor(
    private readonly config: HiveRuntimeCloudConfig,
    private readonly userDataPath: string,
    private readonly runtimeSource: RuntimeSource,
    private readonly dependencies: PresenceDependencies = defaultPresenceDependencies
  ) {
    this.state = config.enabled ? 'WAITING_RUNTIME' : 'DISABLED'
    this.client = config.enabled ? dependencies.createClient(config.apiBaseUrl) : null
    this.bootId = dependencies.randomUuid()
    this.scheduler = new HiveRuntimeCloudPresenceScheduler(dependencies.random)
  }

  getState(): HiveRuntimeCloudPresenceState {
    return this.state
  }

  getBootId(): string {
    return this.bootId
  }

  setRelayHeartbeatContributor(contributor: HiveRuntimeRelayHeartbeatContributor | null): void {
    this.relayHeartbeat.install(contributor)
  }

  requestHeartbeat(): void {
    this.relayHeartbeat.requestHeartbeat()
  }

  subscribeState(listener: (state: HiveRuntimeCloudPresenceState) => void): () => void {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => this.stateListeners.delete(listener)
  }

  getCurrentLeaseContext(): CurrentHiveRuntimeCloudLeaseContext | null {
    return this.leaseContext.current(this.state, this.authorityId, this.lease)
  }

  subscribeLeaseContext(listener: HiveRuntimeCloudLeaseContextListener): () => void {
    return this.leaseContext.subscribe(listener, () => this.getCurrentLeaseContext())
  }

  /**
   * Migrates pre-authority registration state. Signing out intentionally leaves
   * a claimed Runtime's identity-backed heartbeat running.
   */
  setAuthorization(authorization: HiveRuntimeCloudAuthorization | null): void {
    if (!authorization || !this.config.enabled || this.stopped) {
      return
    }
    if (
      migrateHiveRuntimeCloudPresenceAuthorization({
        authorization,
        userDataPath: this.userDataPath,
        dependencies: this.dependencies
      })
    ) {
      this.notifyRegistrationChanged()
    }
  }

  notifyRegistrationChanged(): void {
    this.restartRegistration(false)
  }

  private restartRegistration(spreadInitialActivation: boolean): void {
    if (!this.config.enabled || this.stopped) {
      return
    }
    this.resetWork()
    this.clearLease()
    this.setState(this.runtimeReady ? 'ACTIVATING' : 'WAITING_RUNTIME')
    this.publishLeaseContext()
    if (this.runtimeReady) {
      if (spreadInitialActivation) {
        const epoch = this.epoch
        this.scheduler.scheduleInitial(
          INITIAL_ACTIVATION_WINDOW_MS,
          () => !this.stopped && this.runtimeReady && this.epoch === epoch,
          () => this.startActivation()
        )
      } else {
        this.startActivation()
      }
    }
  }

  setRuntimeReady(ready: boolean): void {
    if (!this.config.enabled || this.stopped || this.runtimeReady === ready) {
      return
    }
    this.runtimeReady = ready
    if (!ready) {
      this.resetWork()
      this.clearLease()
      this.setState('WAITING_RUNTIME')
      this.publishLeaseContext()
      return
    }
    this.restartRegistration(true)
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.resetWork()
    this.clearLease()
    this.setState(this.config.enabled ? 'STOPPED' : 'DISABLED')
    this.publishLeaseContext()
    await this.inFlight?.catch(() => undefined)
  }

  private fence(): void {
    this.resetWork()
    this.clearLease()
    this.setState('FENCED')
    this.publishLeaseContext()
  }

  private resetWork(): void {
    this.epoch += 1
    this.scheduler.reset()
    this.abortController?.abort()
    this.abortController = null
    this.relayHeartbeat.resetRequest()
  }

  private assertCurrent(epoch: number): void {
    if (this.stopped || epoch !== this.epoch || !this.runtimeReady) {
      throw STALE_OPERATION
    }
  }

  private startActivation(): void {
    const epoch = this.epoch
    this.abortController = new AbortController()
    this.inFlight = this.activate(epoch, this.abortController.signal)
      .catch((error: unknown) =>
        handleHiveRuntimeCloudActivationFailure(error, {
          stale: error === STALE_OPERATION || epoch !== this.epoch || this.stopped,
          claimPending: () => this.setState('CLAIM_PENDING'),
          fence: () => this.fence(),
          retry: () => {
            this.setState('OFFLINE_RETRY')
            this.scheduleRetry(() => this.startActivation(), error)
          }
        })
      )
      .finally(() => this.finishOperation(epoch))
  }

  private async activate(epoch: number, signal: AbortSignal): Promise<void> {
    this.assertCurrent(epoch)
    const result = await runHiveRuntimeCloudActivation({
      client: this.client,
      userDataPath: this.userDataPath,
      bootId: this.bootId,
      dependencies: this.dependencies,
      signal,
      assertCurrent: () => this.assertCurrent(epoch),
      saveState: (state) =>
        persistHiveRuntimeCloudRegistrationState(this.dependencies, this.userDataPath, state)
    })
    if (result.status === 'CLAIM_PENDING') {
      this.setState('CLAIM_PENDING')
      return
    }
    this.bootId = result.bootId
    this.authorityId = result.authorityId
    this.leaseContext.setIdentity(result.identity, result.runtimeRecordId)
    this.lease = result.lease
    this.relayHeartbeat.clearPending()
    this.setState('LEASED')
    this.scheduler.resetRetryAttempts()
    try {
      await this.sendHeartbeat(epoch, result.identity, signal)
    } catch (error) {
      this.handleHeartbeatFailureWith(epoch, result.identity, error)
    }
  }

  private async sendHeartbeat(
    epoch: number,
    identity: HiveRuntimeCloudIdentity,
    signal: AbortSignal
  ): Promise<void> {
    this.assertCurrent(epoch)
    if (!this.client || !this.lease || !this.authorityId) {
      throw new FatalPresenceError('lease_unavailable')
    }
    const heartbeat = await this.relayHeartbeat.send({
      client: this.client,
      identity,
      authorityId: this.authorityId,
      lease: this.lease,
      report: this.runtimeSource.getReport(),
      context: this.getCurrentLeaseContext(),
      now: this.dependencies.now,
      signal,
      assertCurrent: () => this.assertCurrent(epoch)
    })
    this.lease.nextHeartbeatSeq = heartbeat.nextHeartbeatSeq
    this.setState('ONLINE')
    this.publishLeaseContext()
    this.scheduler.scheduleHeartbeat(
      heartbeat.heartbeatDelay,
      () => this.epoch === epoch && !this.stopped,
      () => this.startHeartbeat(epoch, identity)
    )
  }

  private startHeartbeat(epoch: number, identity: HiveRuntimeCloudIdentity): void {
    this.abortController = new AbortController()
    this.inFlight = this.sendHeartbeat(epoch, identity, this.abortController.signal)
      .catch((error: unknown) => this.handleHeartbeatFailureWith(epoch, identity, error))
      .finally(() => this.finishOperation(epoch))
  }

  private finishOperation(epoch: number): void {
    if (this.epoch === epoch) {
      this.abortController = null
      this.inFlight = null
      this.relayHeartbeat.flush()
    }
  }

  private handleHeartbeatFailureWith(
    epoch: number,
    identity: HiveRuntimeCloudIdentity,
    error: unknown
  ): void {
    handleHiveRuntimeCloudHeartbeatFailure(error, {
      stale: error === STALE_OPERATION || epoch !== this.epoch || this.stopped,
      tupleChanged: () => {
        this.clearLease()
        this.setState('OFFLINE_RETRY')
        this.publishLeaseContext()
        this.scheduleRetry(() => this.startActivation())
      },
      fence: () => this.fence(),
      retry: () => {
        this.setState('OFFLINE_RETRY')
        this.publishLeaseContext()
        this.scheduleRetry(() => this.startHeartbeat(epoch, identity), error)
      }
    })
  }

  private scheduleRetry(action: () => void, error?: unknown): void {
    this.scheduler.scheduleRetry(error, () => !this.stopped && this.runtimeReady, action)
  }

  private clearLease(): void {
    this.lease = null
    this.authorityId = null
    this.leaseContext.clearIdentity()
    this.relayHeartbeat.clearPending()
  }

  private publishLeaseContext(): void {
    this.leaseContext.publish(this.getCurrentLeaseContext())
  }

  private setState(state: HiveRuntimeCloudPresenceState): void {
    if (this.state === state) {
      return
    }
    this.state = state
    for (const listener of this.stateListeners) {
      listener(state)
    }
  }
}
