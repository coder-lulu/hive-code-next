import type { E2EEKeypair } from '../../runtime/e2ee-keypair'
import limits from '../../../../config/hiverelay-contract/registries/limits.json'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../hive-runtime-cloud-lease-context'
import { HiveRuntimeCloudRequestError } from '../hive-runtime-cloud-http-client'
import { HiveRuntimeRelayControlClient } from './hive-runtime-relay-control-client'
import type { HiveRuntimeRelayAuthorizationProvider } from './hive-runtime-relay-authorization-provider'
import type { ConnectionOpen } from './hive-runtime-relay-protocol'
import {
  hiveRuntimeRelaySameOwner,
  type HiveRuntimeRelaySocketFactory
} from './hive-runtime-relay-socket'
import {
  hiveRuntimeRelayTuplesEqual,
  type HiveRuntimeRelayAssignment
} from './hive-runtime-relay-types'

type Options = {
  provider: Pick<HiveRuntimeRelayAuthorizationProvider, 'resolve' | 'refresh'>
  getContext: () => CurrentHiveRuntimeCloudLeaseContext | null
  getKeypair: () => E2EEKeypair | null
  onAssigned: (assignment: HiveRuntimeRelayAssignment) => void
  onConnection: (assignment: HiveRuntimeRelayAssignment, connection: ConnectionOpen) => void
  onUnavailable: () => void
  createSocket?: HiveRuntimeRelaySocketFactory
  random?: () => number
  now?: () => number
}

/** A claimed Runtime maintains demand independently of paired devices and login UI. */
export class HiveRuntimeRelayBroker {
  private stopped = true
  private generation = 0
  private inFlight: Promise<void> | null = null
  private abort: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private control: HiveRuntimeRelayControlClient | null = null
  private pendingControl: HiveRuntimeRelayControlClient | null = null
  private assignment: HiveRuntimeRelayAssignment | null = null
  private failures = 0
  private context: CurrentHiveRuntimeCloudLeaseContext | null = null

  constructor(private readonly options: Options) {}

  get activeAssignment(): HiveRuntimeRelayAssignment | null {
    return this.control?.active && this.assignment && this.isCurrent(this.assignment)
      ? this.assignment
      : null
  }

  start(): void {
    this.stopped = false
    this.notifyContextChanged()
  }

  notifyContextChanged(): void {
    if (this.stopped) {
      return
    }
    const context = this.options.getContext()
    if (
      context === this.context ||
      (context &&
        this.context &&
        context.authorityId === this.context.authorityId &&
        context.identity.publicKey === this.context.identity.publicKey &&
        hiveRuntimeRelayTuplesEqual(context.tuple, this.context.tuple))
    ) {
      return
    }
    // Heartbeat publications repeat the same tuple while assignment is pending.
    // Preserve in-flight resolution and its backoff instead of requesting another heartbeat.
    this.context = context
    this.invalidate()
    this.failures = 0
    if (!context) {
      return
    }
    this.schedule(0)
  }

  isCurrent(assignment: HiveRuntimeRelayAssignment): boolean {
    const context = this.options.getContext()
    return (
      !this.stopped &&
      !!context &&
      context.authorityId === assignment.context.authorityId &&
      context.identity.publicKey === assignment.context.identity.publicKey &&
      hiveRuntimeRelayTuplesEqual(context.tuple, assignment.context.tuple)
    )
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.context = null
    this.invalidate()
    await this.inFlight
  }

  reconnect(): void {
    if (this.stopped || !this.options.getContext()) {
      return
    }
    this.invalidate()
    this.failures = 0
    this.schedule(0)
  }

  private invalidate(): void {
    this.generation++
    this.abort?.abort()
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
    const control = this.control
    this.control = null
    this.assignment = null
    control?.close()
    this.options.onUnavailable()
  }

  private schedule(delay: number): void {
    if (this.stopped) {
      return
    }
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.inFlight) {
        this.schedule(100)
        return
      }
      this.inFlight = this.resolve().finally(() => {
        this.inFlight = null
      })
    }, delay)
    this.timer.unref()
  }

  private retry(error?: unknown): void {
    if (!this.stopped && this.options.getContext()) {
      const cap = Math.min(30_000, 1_000 * 2 ** Math.min(this.failures++, 5))
      const jitter = 250 + Math.floor((this.options.random ?? Math.random)() * cap)
      const retryAfter =
        error instanceof HiveRuntimeCloudRequestError ? (error.retryAfterMs ?? 0) : 0
      this.schedule(Math.max(jitter, retryAfter))
    }
  }

  private async resolve(): Promise<void> {
    const context = this.options.getContext()
    const keypair = this.options.getKeypair()
    if (this.stopped || !context || !keypair) {
      return
    }
    const generation = this.generation
    const abort = new AbortController()
    this.abort = abort
    try {
      const assignment =
        this.control?.active && this.assignment
          ? await this.options.provider.refresh(this.assignment, abort.signal)
          : await this.options.provider.resolve({ context, keypair, signal: abort.signal })
      if (generation !== this.generation || !this.isCurrent(assignment)) {
        return
      }
      if (
        this.control?.active &&
        this.assignment &&
        hiveRuntimeRelaySameOwner(this.assignment, assignment)
      ) {
        this.pendingControl = this.control
        await this.control.refresh(assignment)
      } else {
        const previous = this.control
        this.control = null
        previous?.close()
        this.options.onUnavailable()
        const control = new HiveRuntimeRelayControlClient({
          assignment,
          keypair,
          createSocket: this.options.createSocket,
          now: this.options.now,
          onConnectionOpen: (connection) => {
            if (this.control === control && this.isCurrent(assignment)) {
              this.options.onConnection(assignment, connection)
            }
          },
          onDrain: () => this.options.onUnavailable(),
          onClose: () => {
            if (this.control !== control) {
              return
            }
            this.control = null
            this.options.onUnavailable()
            // A pending connect/refresh rejection owns its retry in resolve's catch.
            if (this.pendingControl !== control) {
              this.retry()
            }
          }
        })
        this.control = control
        this.pendingControl = control
        await control.connect()
      }
      if (generation !== this.generation || !this.isCurrent(assignment)) {
        return
      }
      if (!this.control?.active) {
        throw new Error('hive_runtime_relay_control_closed')
      }
      this.pendingControl = null
      this.assignment = assignment
      this.failures = 0
      this.options.onAssigned(assignment)
      // The Cell retires control at signed expiry minus its maximum clock error.
      // Refresh halfway through that usable window, not halfway to the signed expiry.
      const remaining =
        assignment.controlLeaseExpiresAt -
        (this.options.now ?? Date.now)() -
        limits.time.clockSkewSeconds * 1000
      this.schedule(Math.max(1_000, Math.floor(remaining / 2)))
    } catch (error) {
      if (generation === this.generation) {
        const control = this.control
        this.control = null
        this.assignment = null
        control?.close()
        if (control) {
          this.options.onUnavailable()
        }
        this.retry(error)
      }
    } finally {
      if (this.abort === abort) {
        this.abort = null
        this.pendingControl = null
      }
    }
  }
}
