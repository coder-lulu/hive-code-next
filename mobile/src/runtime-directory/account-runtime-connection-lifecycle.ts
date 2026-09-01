import type { StableLogicalRpcClient } from '../transport/stable-logical-rpc-client'
import type { RpcClient } from '../transport/rpc-client'
import type {
  AccountRuntimeRoute,
  ConnectionLogSink,
  ForegroundNudgeReason
} from '../transport/types'
import { connectAccountRuntimeRpcSession } from './account-runtime-rpc-session'

const LOCAL_FALLBACK_GRACE_MS = 2_500
const MAXIMUM_RETRY_DELAY_MS = 30_000

type AccountRuntimeConnectionLifecycleDependencies = {
  connect: typeof connectAccountRuntimeRpcSession
  setTimer: typeof setTimeout
  clearTimer: typeof clearTimeout
}

const defaultDependencies: AccountRuntimeConnectionLifecycleDependencies = {
  connect: connectAccountRuntimeRpcSession,
  setTimer: setTimeout,
  clearTimer: clearTimeout
}

export class AccountRuntimeConnectionLifecycle {
  private stopped = false
  private foreground = true
  private operationInFlight = false
  private recoveryEpoch = 0
  private retryCount = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private intentController: AbortController | null = null
  private pendingSession: RpcClient | null = null
  private readonly unsubscribeState: () => void

  constructor(
    private readonly logical: StableLogicalRpcClient,
    private readonly route: AccountRuntimeRoute,
    private readonly mode: 'account-only' | 'local-fallback',
    private readonly onLog: ConnectionLogSink,
    private readonly dependencies: AccountRuntimeConnectionLifecycleDependencies = defaultDependencies
  ) {
    this.unsubscribeState = logical.onStateChange((state) => {
      if (state === 'connected') {
        this.retryCount = 0
        this.clearTimer()
      } else if (this.shouldRecover(state)) {
        this.schedule()
      }
    })
  }

  start(): void {
    const state = this.logical.getState()
    if (this.shouldRecover(state)) {
      this.schedule(this.mode === 'local-fallback' ? LOCAL_FALLBACK_GRACE_MS : 0)
    }
  }

  setForeground(foreground: boolean): void {
    this.foreground = foreground
    if (!foreground) {
      this.clearTimer()
      this.cancelRecovery()
      return
    }
    if (this.logical.getState() !== 'connected') {
      this.schedule(this.mode === 'local-fallback' ? LOCAL_FALLBACK_GRACE_MS : 0)
    }
  }

  nudge(_reason: ForegroundNudgeReason): void {
    if (this.foreground && this.logical.getState() !== 'connected') {
      this.schedule(0)
    }
  }

  stop(): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.clearTimer()
    this.cancelRecovery()
    this.unsubscribeState()
  }

  private shouldRecover(state: ReturnType<StableLogicalRpcClient['getState']>): boolean {
    if (this.mode === 'local-fallback') {
      return state !== 'connected'
    }
    return state === 'disconnected' || state === 'auth-failed'
  }

  private schedule(delay = this.retryDelay()): void {
    if (
      this.stopped ||
      !this.foreground ||
      this.operationInFlight ||
      this.timer ||
      this.logical.getState() === 'connected'
    ) {
      return
    }
    this.timer = this.dependencies.setTimer(() => {
      this.timer = null
      void this.recover()
    }, delay)
  }

  private async recover(): Promise<void> {
    if (
      this.stopped ||
      !this.foreground ||
      this.operationInFlight ||
      this.logical.getState() === 'connected'
    ) {
      return
    }
    this.operationInFlight = true
    const generation = this.logical.getGeneration()
    const recoveryEpoch = this.recoveryEpoch
    const intentController = new AbortController()
    this.intentController = intentController
    let replacement: RpcClient | null = null
    try {
      const connection = await this.route.createConnection(intentController.signal)
      if (this.intentController === intentController) {
        this.intentController = null
      }
      if (!this.recoveryIsCurrent(recoveryEpoch, generation)) {
        return
      }
      const expiresAt = Date.parse(connection.expiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('account Runtime connection intent expired before use')
      }
      replacement = this.dependencies.connect({ connection, onLog: this.onLog })
      this.pendingSession = replacement
      await this.logical.migrateTo(
        replacement,
        'relay',
        12_000,
        () => !this.recoveryIsCurrent(recoveryEpoch, generation)
      )
      this.retryCount = 0
    } catch (error) {
      if (
        replacement &&
        this.pendingSession === replacement &&
        this.logical.getState() !== 'connected'
      ) {
        replacement.close()
        this.pendingSession = null
      }
      if (
        recoveryEpoch === this.recoveryEpoch &&
        !this.stopped &&
        this.foreground &&
        this.logical.getState() !== 'connected'
      ) {
        this.retryCount += 1
        this.onLog({
          id: `account-runtime-recovery-${Date.now()}`,
          ts: Date.now(),
          level: 'warn',
          code: 'relay-dial-failed',
          path: 'relay',
          message: 'Account Runtime recovery failed',
          detail: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120)
        })
      }
    } finally {
      if (recoveryEpoch === this.recoveryEpoch) {
        if (this.intentController === intentController) {
          this.intentController = null
        }
        if (this.pendingSession === replacement) {
          this.pendingSession = null
        }
        this.operationInFlight = false
        if (!this.stopped && this.logical.getState() !== 'connected') {
          this.schedule()
        }
      }
    }
  }

  private recoveryIsCurrent(recoveryEpoch: number, generation: number): boolean {
    return (
      recoveryEpoch === this.recoveryEpoch &&
      !this.stopped &&
      this.foreground &&
      this.logical.getGeneration() === generation &&
      this.logical.getState() !== 'connected'
    )
  }

  private cancelRecovery(): void {
    this.recoveryEpoch += 1
    this.operationInFlight = false
    this.intentController?.abort()
    this.intentController = null
    if (this.pendingSession && this.logical.getState() !== 'connected') {
      this.pendingSession.close()
    }
    this.pendingSession = null
  }

  private retryDelay(): number {
    if (this.retryCount === 0) {
      return this.mode === 'local-fallback' ? LOCAL_FALLBACK_GRACE_MS : 1_000
    }
    return Math.min(1_000 * 2 ** Math.min(this.retryCount, 5), MAXIMUM_RETRY_DELAY_MS)
  }

  private clearTimer(): void {
    if (!this.timer) {
      return
    }
    this.dependencies.clearTimer(this.timer)
    this.timer = null
  }
}
