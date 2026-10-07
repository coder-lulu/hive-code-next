import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeCloudPresenceAccountSession } from './hive-runtime-cloud-presence-session'
import {
  persistHiveRuntimeCloudRegistrationState,
  runHiveRuntimeCloudActivation
} from './hive-runtime-cloud-activation-runner'
import type { HiveRuntimeCloudConfig } from './hive-runtime-cloud-config'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import {
  defaultPresenceDependencies,
  FatalPresenceError,
  HiveRuntimeCloudPresencePublication,
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
  private readonly publication: HiveRuntimeCloudPresencePublication
  private authorityId: string | null = null
  private runtimeReady = false
  private stopped = false
  private bootId: string
  private lease: ActiveLease | null = null
  private readonly accountSession: HiveRuntimeCloudPresenceAccountSession
  private readonly leaseContext = new HiveRuntimeCloudLeaseContextPublisher(
    () => this.dependencies.now(),
    () => this.publication.set('OFFLINE_RETRY')
  )
  private readonly scheduler: HiveRuntimeCloudPresenceScheduler
  private readonly relayHeartbeat = new HiveRuntimeCloudPresenceRelay(() => {
    const context = this.getCurrentLeaseContext()
    if (this.scheduler.inFlight || !context || this.stopped) {
      return false
    }
    this.scheduler.reset()
    this.startHeartbeat(this.scheduler.epoch, context.identity)
    return true
  })

  constructor(
    private readonly config: HiveRuntimeCloudConfig,
    private readonly userDataPath: string,
    private readonly runtimeSource: RuntimeSource,
    private readonly dependencies: PresenceDependencies = defaultPresenceDependencies
  ) {
    this.publication = new HiveRuntimeCloudPresencePublication(
      config.enabled ? 'SIGNED_OUT' : 'DISABLED'
    )
    this.client = config.enabled ? dependencies.createClient(config.apiBaseUrl) : null
    this.bootId = dependencies.randomUuid()
    this.scheduler = new HiveRuntimeCloudPresenceScheduler(dependencies.random)
    this.accountSession = new HiveRuntimeCloudPresenceAccountSession(dependencies.now, () =>
      this.setAuthorization(null)
    )
  }

  getState(): HiveRuntimeCloudPresenceState {
    return this.publication.value
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
    return this.publication.subscribe(listener)
  }

  getCurrentLeaseContext(): CurrentHiveRuntimeCloudLeaseContext | null {
    return this.accountSession.current()
      ? this.leaseContext.current(this.publication.value, this.authorityId, this.lease)
      : null
  }

  subscribeLeaseContext(listener: HiveRuntimeCloudLeaseContextListener): () => void {
    return this.leaseContext.subscribe(listener, () => this.getCurrentLeaseContext())
  }

  setAuthorization(authorization: HiveRuntimeCloudAuthorization | null): void {
    if (!this.config.enabled || this.stopped) {
      return
    }
    const changed = this.accountSession.update(authorization)
    const session = this.accountSession.current()
    if (!session) {
      this.invalidate('SIGNED_OUT')
      return
    }
    const migrated = migrateHiveRuntimeCloudPresenceAuthorization({
      authorization: session,
      userDataPath: this.userDataPath,
      dependencies: this.dependencies
    })
    if (changed || migrated || this.publication.value === 'FENCED') {
      this.restartRegistration(false)
    }
  }

  notifyRegistrationChanged(): void {
    this.restartRegistration(false)
  }

  private restartRegistration(spreadInitialActivation: boolean): void {
    if (!this.config.enabled || this.stopped) {
      return
    }
    const authorized = this.accountSession.current() !== null
    this.invalidate(
      !authorized ? 'SIGNED_OUT' : this.runtimeReady ? 'ACTIVATING' : 'WAITING_RUNTIME'
    )
    if (this.runtimeReady && authorized) {
      if (spreadInitialActivation) {
        const epoch = this.scheduler.epoch
        this.scheduler.scheduleInitial(
          INITIAL_ACTIVATION_WINDOW_MS,
          () => this.canRun(epoch),
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
      this.invalidate(this.accountSession.current() ? 'WAITING_RUNTIME' : 'SIGNED_OUT')
      return
    }
    this.restartRegistration(true)
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.accountSession.clear()
    this.invalidate(this.config.enabled ? 'STOPPED' : 'DISABLED')
    await this.scheduler.inFlight?.catch(() => undefined)
  }

  private invalidate(state: HiveRuntimeCloudPresenceState): void {
    this.scheduler.cancelOperation()
    this.relayHeartbeat.resetRequest()
    this.clearLease()
    this.publication.set(state)
    this.publishLeaseContext()
  }

  private canRun(epoch: number): boolean {
    return (
      !this.stopped &&
      epoch === this.scheduler.epoch &&
      this.runtimeReady &&
      this.accountSession.current() !== null
    )
  }

  private assertCurrent(epoch: number): void {
    if (!this.canRun(epoch)) {
      throw STALE_OPERATION
    }
  }

  private startActivation(): void {
    if (!this.canRun(this.scheduler.epoch)) {
      return
    }
    const epoch = this.scheduler.epoch
    this.scheduler.run(
      (signal) => this.activate(epoch, signal),
      (error) =>
        handleHiveRuntimeCloudActivationFailure(error, {
          stale: error === STALE_OPERATION || epoch !== this.scheduler.epoch || this.stopped,
          claimPending: () => this.publication.set('CLAIM_PENDING'),
          fence: () => this.invalidate('FENCED'),
          retry: () => {
            this.publication.set('OFFLINE_RETRY')
            this.scheduleRetry(() => this.startActivation(), error)
          }
        }),
      () => this.relayHeartbeat.flush()
    )
  }

  private async activate(epoch: number, signal: AbortSignal): Promise<void> {
    this.assertCurrent(epoch)
    const result = await runHiveRuntimeCloudActivation({
      client: this.client,
      authorization: () => this.accountSession.current(),
      userDataPath: this.userDataPath,
      bootId: this.bootId,
      dependencies: this.dependencies,
      signal,
      assertCurrent: () => this.assertCurrent(epoch),
      saveState: (state) =>
        persistHiveRuntimeCloudRegistrationState(this.dependencies, this.userDataPath, state)
    })
    this.assertCurrent(epoch)
    this.bootId = result.bootId
    this.authorityId = result.authorityId
    this.leaseContext.setIdentity(result.identity, result.runtimeRecordId)
    this.lease = result.lease
    this.relayHeartbeat.clearPending()
    this.publication.set('LEASED')
    this.scheduler.resetRetryAttempts()
    await this.sendHeartbeat(epoch, result.identity, signal).catch((error: unknown) =>
      this.handleHeartbeatFailureWith(epoch, result.identity, error)
    )
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
      authorization: () => this.accountSession.current(),
      identity,
      authorityId: this.authorityId,
      lease: this.lease,
      report: this.runtimeSource.getReport(),
      context: this.getCurrentLeaseContext(),
      now: this.dependencies.now,
      signal,
      onAccepted: (proof) => this.leaseContext.accept(this.lease!, proof),
      assertCurrent: () => this.assertCurrent(epoch)
    })
    this.assertCurrent(epoch)
    this.lease.nextHeartbeatSeq = heartbeat.nextHeartbeatSeq
    this.publication.set('ONLINE')
    this.publishLeaseContext()
    this.scheduler.scheduleHeartbeat(
      heartbeat.heartbeatDelay,
      () => this.canRun(epoch),
      () => this.startHeartbeat(epoch, identity)
    )
  }

  private startHeartbeat(epoch: number, identity: HiveRuntimeCloudIdentity): void {
    if (!this.canRun(epoch)) {
      return
    }
    this.scheduler.run(
      (signal) => this.sendHeartbeat(epoch, identity, signal),
      (error) => this.handleHeartbeatFailureWith(epoch, identity, error),
      () => this.relayHeartbeat.flush()
    )
  }

  private handleHeartbeatFailureWith(
    epoch: number,
    identity: HiveRuntimeCloudIdentity,
    error: unknown
  ): void {
    handleHiveRuntimeCloudHeartbeatFailure(error, {
      stale: error === STALE_OPERATION || epoch !== this.scheduler.epoch || this.stopped,
      tupleChanged: () => {
        this.invalidate('OFFLINE_RETRY')
        this.scheduleRetry(() => this.startActivation())
      },
      fence: () => this.invalidate('FENCED'),
      retry: () => {
        this.publication.set('OFFLINE_RETRY')
        this.publishLeaseContext()
        this.scheduleRetry(() => this.startHeartbeat(epoch, identity), error)
      }
    })
  }

  private scheduleRetry(action: () => void, error?: unknown): void {
    const epoch = this.scheduler.epoch
    this.scheduler.scheduleRetry(error, () => this.canRun(epoch), action)
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
}
