import { randomUUID } from 'node:crypto'
import type {
  E2EEAccountAuth,
  E2EEAccountBinding,
  E2EEAuthenticatedAccountSession
} from '../../runtime/rpc/e2ee-channel-account-authentication'
import type { HiveRuntimeRelayCloudClient } from './hive-runtime-relay-cloud-client'
import type { ConnectionOpen } from './hive-runtime-relay-protocol'
import type {
  HiveRuntimeRelayAssignment,
  HiveRuntimeRelayConsumeResult
} from './hive-runtime-relay-types'
import type { HiveRuntimeRelaySessionTransitionOutbox } from './hive-runtime-relay-session-transition-outbox'
import type {
  HiveRuntimeRelayTransitionReason,
  HiveRuntimeRelayTransitionType
} from './hive-runtime-relay-session-transition-types'
import { createHiveRuntimeRelayAccountConsumeInput } from './hive-runtime-relay-account-binding'

export type HiveRuntimeRelayAccountSessionOptions = {
  assignment: HiveRuntimeRelayAssignment
  connection: ConnectionOpen
  client: Pick<HiveRuntimeRelayCloudClient, 'consume'>
  outbox: Pick<HiveRuntimeRelaySessionTransitionOutbox, 'enqueue' | 'canAccept'>
  isCurrent: () => boolean
  getSessionAuthorityUntil: () => number | null
  requestHeartbeat: () => void
  onClose: () => void
  onPersistenceFailure: () => void
  now?: () => number
}

export class HiveRuntimeRelayAccountSession {
  private attempted = false
  private closed = false
  private active = false
  private revoked = false
  private consumed: HiveRuntimeRelayConsumeResult | null = null
  private bindingHash = ''
  private controlVersion = 0
  private lastActivity = 0
  private authorityUntil = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private controller = new AbortController()
  private terminalRecorded = false
  private readonly now: () => number

  constructor(private readonly options: HiveRuntimeRelayAccountSessionOptions) {
    const wallNow = options.now ?? Date.now
    const startedAt = wallNow()
    const monotonicStart = performance.now()
    // Local clock rollback cannot extend an already granted session deadline.
    this.now = () => Math.floor(Math.max(wallNow(), startedAt + performance.now() - monotonicStart))
  }

  get managedSessionId(): string | null {
    return this.consumed?.managedSessionId ?? null
  }
  get runtimeSessionId(): string | null {
    return this.consumed?.runtimeSessionId ?? null
  }

  async authenticate(
    auth: E2EEAccountAuth,
    signal: AbortSignal,
    binding: E2EEAccountBinding
  ): Promise<E2EEAuthenticatedAccountSession | null> {
    if (
      this.attempted ||
      this.closed ||
      signal.aborted ||
      !this.options.isCurrent() ||
      !this.options.outbox.canAccept
    ) {
      return null
    }
    this.attempted = true
    const cancel = () => this.close('TRANSPORT_CLOSED')
    signal.addEventListener('abort', cancel, { once: true })
    this.timer = setTimeout(cancel, 10_000)
    this.timer.unref()
    try {
      const input = createHiveRuntimeRelayAccountConsumeInput(
        this.options.assignment,
        this.options.connection,
        auth,
        binding,
        randomUUID()
      )
      this.bindingHash = input.sessionBindingHash
      const consumption = this.options.client
        .consume(this.options.assignment.context, auth.ticketId, input, this.controller.signal)
        .then((result) => {
          this.consumed = result
          this.controlVersion = result.controlVersion
          if (this.closed) {
            this.recordTerminal('ABANDON', 'ABANDONED_BEFORE_ACTIVATION')
          }
          return result
        })
      const consumed = await this.waitForActivation(consumption)
      if (!consumed) {
        return null
      }
      if (
        !this.current() ||
        consumed.activationDeadlineAt <= this.now() ||
        consumed.absoluteExpiresAt <= this.now()
      ) {
        this.close('LOCAL_ERROR')
        this.recordTerminal('ABANDON', 'ABANDONED_BEFORE_ACTIVATION')
        return null
      }
      const activation = this.transition('ACTIVATE', 'ACTIVATED')
      const completion = activation.completion.then((settlement) => {
        if (
          this.closed &&
          settlement.result.verdict === 'APPLIED' &&
          settlement.result.resultingStatus === 'ACTIVE'
        ) {
          this.active = true
          this.controlVersion = settlement.result.resultingControlVersion
          this.terminalRecorded = false
          this.recordTerminal('CLOSE', 'LOCAL_ERROR')
        }
        return settlement
      })
      const settled = await this.waitForActivation(completion)
      if (!settled) {
        return null
      }
      if (settled.result.verdict === 'APPLIED' && settled.result.resultingStatus === 'ACTIVE') {
        this.active = true
        this.controlVersion = settled.result.resultingControlVersion
        // A cancellation may race an ACTIVATE already committed in Cloud.
        if (
          !this.current() ||
          !settled.activationEligible ||
          consumed.activationDeadlineAt <= this.now()
        ) {
          this.terminalRecorded = false
          this.close('LOCAL_ERROR')
          this.recordTerminal('CLOSE', 'LOCAL_ERROR')
          return null
        }
      } else {
        this.close('LOCAL_ERROR')
        return null
      }
      this.lastActivity = this.now()
      this.authorityUntil = this.options.getSessionAuthorityUntil() ?? 0
      if (!this.revalidate()) {
        return null
      }
      return Object.freeze({
        principalKind: 'account_runtime_session',
        runtimeSessionId: consumed.runtimeSessionId,
        expiresAt: Math.min(consumed.absoluteExpiresAt, this.authorityUntil)
      })
    } catch {
      this.close('LOCAL_ERROR')
      return null
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }

  private async waitForActivation<T>(completion: Promise<T>): Promise<T | null> {
    const signal = this.controller.signal
    if (signal.aborted) {
      return null
    }
    let cancel!: () => void
    const aborted = new Promise<null>((resolve) => {
      cancel = () => resolve(null)
      signal.addEventListener('abort', cancel, { once: true })
    })
    try {
      return await Promise.race([completion, aborted])
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }

  private current(): boolean {
    return !this.closed && !this.controller.signal.aborted && this.options.isCurrent()
  }

  revalidate(touch = false): boolean {
    if (!this.active || !this.consumed || !this.current()) {
      this.close('LOCAL_ERROR')
      return false
    }
    const now = this.now()
    if (this.consumed.absoluteExpiresAt <= now) {
      this.close('LOCAL_ERROR')
      return false
    }
    if (this.authorityUntil <= now) {
      this.terminate('AUTHORITY_EXPIRE', 'SESSION_AUTHORITY_TIMEOUT')
      return false
    }
    if (this.lastActivity + 900_000 <= now) {
      this.terminate('IDLE_EXPIRE', 'IDLE_TIMEOUT')
      return false
    }
    if (touch) {
      this.lastActivity = now
    }
    this.schedule()
    return true
  }

  refreshAuthority(): void {
    if (!this.active || !this.revalidate()) {
      return
    }
    const deadline = this.options.getSessionAuthorityUntil()
    if (deadline !== null && Number.isSafeInteger(deadline) && deadline > this.now()) {
      this.authorityUntil = deadline
    }
    this.revalidate()
  }

  revoke(): void {
    this.revoked = true
    this.close('LOCAL_ERROR')
  }

  close(reason: HiveRuntimeRelayTransitionReason = 'CLIENT_CLOSED'): void {
    this.terminate(
      this.active ? 'CLOSE' : 'ABANDON',
      this.active ? reason : 'ABANDONED_BEFORE_ACTIVATION'
    )
  }

  private terminate(
    type: HiveRuntimeRelayTransitionType,
    reason: HiveRuntimeRelayTransitionReason
  ): void {
    const first = !this.closed
    this.closed = true
    this.controller.abort()
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
    this.recordTerminal(type, reason)
    if (first) {
      this.options.onClose()
    }
  }

  private recordTerminal(
    type: HiveRuntimeRelayTransitionType,
    reason: HiveRuntimeRelayTransitionReason
  ): void {
    if (this.revoked || !this.consumed || this.terminalRecorded) {
      return
    }
    try {
      this.transition(type, reason)
      this.terminalRecorded = true
    } catch {
      this.options.onPersistenceFailure()
    }
  }

  private transition(
    transitionType: HiveRuntimeRelayTransitionType,
    reason: HiveRuntimeRelayTransitionReason
  ) {
    const consumed = this.consumed!
    const handle = this.options.outbox.enqueue({
      transitionType,
      reason,
      managedSessionId: consumed.managedSessionId,
      runtimeSessionId: consumed.runtimeSessionId,
      expectedControlVersion: this.controlVersion,
      sessionBindingHash: this.bindingHash,
      occurredAt: this.now()
    })
    try {
      this.options.requestHeartbeat()
    } catch {
      this.options.onPersistenceFailure()
    }
    return handle
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    const deadline = Math.min(
      this.consumed!.absoluteExpiresAt,
      this.authorityUntil,
      this.lastActivity + 900_000
    )
    this.timer = setTimeout(
      () => this.revalidate(),
      Math.min(2_147_483_647, Math.max(1, deadline - this.now()))
    )
    this.timer.unref()
  }
}
