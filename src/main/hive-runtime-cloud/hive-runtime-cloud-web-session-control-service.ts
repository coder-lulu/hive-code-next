import { HiveRuntimeCloudClient } from './hive-runtime-cloud-client'
import type { CurrentHiveRuntimeCloudLeaseContext } from './hive-runtime-cloud-lease-context'
import type { HiveRuntimeCloudControlledRevocationResult } from './hive-runtime-cloud-managed-session-registry'
import type { HiveRuntimeCloudPresenceService } from './hive-runtime-cloud-presence-service'
import {
  createRuntimeWebSessionControlPullRequest,
  createRuntimeWebSessionRevocationAckRequest,
  type RuntimeWebSessionRevocationAcknowledgement
} from './hive-runtime-cloud-web-session-control-proof'
import type { HiveRuntimeCloudWebLaunchService } from './hive-runtime-cloud-web-launch-service'

const DEFAULT_PULL_INTERVAL_MS = 15_000
const PULL_LIMIT = 50
const ACK_LIMIT = 100

type ControlClient = Pick<
  HiveRuntimeCloudClient,
  'pullWebSessionControls' | 'acknowledgeWebSessionRevocations'
>
type PresenceSource = Pick<
  HiveRuntimeCloudPresenceService,
  'getCurrentLeaseContext' | 'subscribeLeaseContext'
>
type RevocationTarget = Pick<
  HiveRuntimeCloudWebLaunchService,
  'revokeManagedSession' | 'expireManagedSessions'
>

export type HiveRuntimeCloudWebSessionControlServiceOptions = Readonly<{
  apiBaseUrl: string
  presence: PresenceSource
  target: RevocationTarget
  client?: ControlClient
  pullIntervalMs?: number
  random?: () => number
  now?: () => number
}>

export class HiveRuntimeCloudWebSessionControlService {
  private readonly client: ControlClient
  private readonly pullIntervalMs: number
  private readonly random: () => number
  private readonly now: () => number
  private readonly pending = new Map<string, RuntimeWebSessionRevocationAcknowledgement>()
  private readonly highestControlVersions = new Map<string, number>()
  private activeContextKey: string | null = null
  private epoch = 0
  private timer: NodeJS.Timeout | undefined
  private controller: AbortController | null = null
  private inFlight: Promise<void> | null = null
  private unsubscribe: (() => void) | null = null
  private stopped = false

  constructor(private readonly options: HiveRuntimeCloudWebSessionControlServiceOptions) {
    this.client = options.client ?? new HiveRuntimeCloudClient(options.apiBaseUrl)
    this.pullIntervalMs = options.pullIntervalMs ?? DEFAULT_PULL_INTERVAL_MS
    this.random = options.random ?? Math.random
    this.now = options.now ?? (() => performance.now())
    if (
      !Number.isSafeInteger(this.pullIntervalMs) ||
      this.pullIntervalMs < 1 ||
      this.pullIntervalMs > DEFAULT_PULL_INTERVAL_MS
    ) {
      throw new Error('invalid_web_session_control_pull_interval')
    }
  }

  start(): void {
    if (this.unsubscribe || this.stopped) {
      return
    }
    this.unsubscribe = this.options.presence.subscribeLeaseContext((context) => {
      this.handleContext(context)
    })
  }

  async pollNow(): Promise<void> {
    const context = this.options.presence.getCurrentLeaseContext()
    if (!context || this.stopped) {
      return
    }
    this.ensureContext(context)
    this.cancelTimer()
    await this.startCycle(context)
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = null
    const pending = this.inFlight
    this.resetCycle()
    this.activeContextKey = null
    this.pending.clear()
    this.highestControlVersions.clear()
    await pending?.catch(() => undefined)
  }

  private handleContext(context: CurrentHiveRuntimeCloudLeaseContext | null): void {
    const nextKey = context ? contextKey(context) : null
    if (nextKey === this.activeContextKey) {
      return
    }
    this.resetCycle()
    this.activeContextKey = nextKey
    this.pending.clear()
    this.highestControlVersions.clear()
    if (context) {
      this.timer = setTimeout(
        () => this.runScheduledCycle(),
        initialPullDelay(this.pullIntervalMs, this.random)
      )
    }
  }

  private ensureContext(context: CurrentHiveRuntimeCloudLeaseContext): void {
    const key = contextKey(context)
    if (this.activeContextKey === key) {
      return
    }
    this.resetCycle()
    this.activeContextKey = key
    this.pending.clear()
    this.highestControlVersions.clear()
  }

  private resetCycle(): void {
    this.epoch += 1
    this.cancelTimer()
    this.controller?.abort()
    this.controller = null
    this.inFlight = null
  }

  private cancelTimer(): void {
    if (this.timer === undefined) {
      return
    }
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private runScheduledCycle(): void {
    this.timer = undefined
    const context = this.options.presence.getCurrentLeaseContext()
    if (!context || this.stopped || contextKey(context) !== this.activeContextKey) {
      return
    }
    void this.startCycle(context).catch(() => undefined)
  }

  private startCycle(context: CurrentHiveRuntimeCloudLeaseContext): Promise<void> {
    if (this.inFlight) {
      return this.inFlight
    }
    const epoch = this.epoch
    const startedAt = this.now()
    const controller = new AbortController()
    this.controller = controller
    const cycle = this.runCycle(context, epoch, controller.signal).finally(() => {
      this.finishCycle(context, epoch, controller, startedAt)
    })
    this.inFlight = cycle
    return cycle
  }

  private finishCycle(
    context: CurrentHiveRuntimeCloudLeaseContext,
    epoch: number,
    controller: AbortController,
    startedAt: number
  ): void {
    if (this.controller !== controller) {
      return
    }
    this.controller = null
    this.inFlight = null
    const current = this.options.presence.getCurrentLeaseContext()
    if (
      this.stopped ||
      this.unsubscribe === null ||
      epoch !== this.epoch ||
      current === null ||
      contextKey(current) !== contextKey(context)
    ) {
      return
    }
    const elapsed = this.now() - startedAt
    const delay = Number.isFinite(elapsed)
      ? Math.max(0, this.pullIntervalMs - Math.max(0, elapsed))
      : this.pullIntervalMs
    this.timer = setTimeout(() => this.runScheduledCycle(), delay)
  }

  private async runCycle(
    context: CurrentHiveRuntimeCloudLeaseContext,
    epoch: number,
    signal: AbortSignal
  ): Promise<void> {
    this.options.target.expireManagedSessions()
    let commands
    try {
      commands = await this.client.pullWebSessionControls(
        createRuntimeWebSessionControlPullRequest(
          context.identity,
          { ...context.tuple, limit: PULL_LIMIT },
          { authorityId: context.authorityId }
        ),
        signal
      )
    } catch {
      await this.flushAcknowledgements(context, epoch, signal)
      return
    }
    if (!this.isCurrent(context, epoch)) {
      return
    }
    for (const command of commands.commands) {
      this.applyCommand(command)
    }
    await this.flushAcknowledgements(context, epoch, signal)
  }

  private applyCommand(command: {
    managedWebSessionId: string
    runtimeSessionId: string
    controlVersion: number
    action: 'REVOKE'
  }): void {
    const highest = this.highestControlVersions.get(command.managedWebSessionId) ?? 0
    if (command.controlVersion < highest) {
      return
    }
    const result = this.options.target.revokeManagedSession(command)
    if (!safeToAcknowledge(result)) {
      return
    }
    this.highestControlVersions.set(command.managedWebSessionId, command.controlVersion)
    this.pending.set(command.managedWebSessionId, {
      managedWebSessionId: command.managedWebSessionId,
      controlVersion: command.controlVersion,
      action: 'REVOKE'
    })
  }

  private async flushAcknowledgements(
    context: CurrentHiveRuntimeCloudLeaseContext,
    epoch: number,
    signal: AbortSignal
  ): Promise<void> {
    if (!this.isCurrent(context, epoch) || this.pending.size === 0) {
      return
    }
    const acknowledgements = [...this.pending.values()].slice(0, ACK_LIMIT)
    try {
      await this.client.acknowledgeWebSessionRevocations(
        createRuntimeWebSessionRevocationAckRequest(
          context.identity,
          { ...context.tuple, acknowledgements },
          { authorityId: context.authorityId }
        ),
        signal
      )
    } catch {
      return
    }
    if (!this.isCurrent(context, epoch)) {
      return
    }
    for (const acknowledgement of acknowledgements) {
      if (
        this.pending.get(acknowledgement.managedWebSessionId)?.controlVersion ===
        acknowledgement.controlVersion
      ) {
        this.pending.delete(acknowledgement.managedWebSessionId)
      }
    }
  }

  private isCurrent(context: CurrentHiveRuntimeCloudLeaseContext, epoch: number): boolean {
    const current = this.options.presence.getCurrentLeaseContext()
    return (
      !this.stopped &&
      epoch === this.epoch &&
      current !== null &&
      contextKey(current) === contextKey(context)
    )
  }
}

function safeToAcknowledge(result: HiveRuntimeCloudControlledRevocationResult): boolean {
  return result === 'REVOKED' || result === 'ABSENT'
}

function contextKey(context: CurrentHiveRuntimeCloudLeaseContext): string {
  const tuple = context.tuple
  return [
    context.authorityId,
    tuple.authorityGeneration,
    tuple.runtimeRecordId,
    tuple.runtimeInstanceId,
    tuple.bootId,
    tuple.heartbeatLeaseId,
    tuple.leaseEpoch,
    tuple.fencingEpoch
  ].join(':')
}

function initialPullDelay(intervalMs: number, random: () => number): number {
  return Math.round(intervalMs * boundedRandom(random))
}

function boundedRandom(random: () => number): number {
  const value = random()
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
}
