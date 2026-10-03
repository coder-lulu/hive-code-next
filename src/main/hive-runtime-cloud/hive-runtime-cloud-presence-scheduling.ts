import { schedulePresenceRetry } from './hive-runtime-cloud-presence-support'

export function hiveRuntimeCloudHeartbeatDelay(authorityUntil: number | null, now: number): number {
  // Cell observations can grant less than 30 seconds. Renew halfway through the
  // remaining grant to leave room for jitter and latency, with a floor to avoid
  // immediate heartbeat feedback when a grant is nearly expired.
  return authorityUntil === null
    ? 30_000
    : Math.min(30_000, Math.max(1_000, (authorityUntil - now) / 2))
}

export function scheduleHiveRuntimeCloudHeartbeat(
  delayMs: number,
  random: () => number,
  canRun: () => boolean,
  action: () => void
): NodeJS.Timeout {
  const randomUnit = boundedRandom(random)
  const jitteredDelayMs = Math.round(delayMs * (0.9 + randomUnit * 0.2))
  const timer = setTimeout(() => {
    if (canRun()) {
      action()
    }
  }, jitteredDelayMs)
  timer.unref?.()
  return timer
}

export function scheduleHiveRuntimeCloudInitialPhase(
  maximumDelayMs: number,
  random: () => number,
  canRun: () => boolean,
  action: () => void
): NodeJS.Timeout {
  const timer = setTimeout(
    () => {
      if (canRun()) {
        action()
      }
    },
    Math.round(maximumDelayMs * boundedRandom(random))
  )
  timer.unref?.()
  return timer
}

function boundedRandom(random: () => number): number {
  const value = random()
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
}

export class HiveRuntimeCloudPresenceScheduler {
  epoch = 0
  inFlight: Promise<void> | null = null
  private abortController: AbortController | null = null
  private timer: NodeJS.Timeout | undefined
  private retryAttempt = 0

  constructor(private readonly random: () => number) {}

  cancelOperation(): void {
    this.epoch += 1
    this.reset()
    this.abortController?.abort()
    this.abortController = null
  }

  run(
    operation: (signal: AbortSignal) => Promise<void>,
    onFailure: (error: unknown) => void,
    onFinished: () => void
  ): void {
    const epoch = this.epoch
    this.abortController = new AbortController()
    this.inFlight = operation(this.abortController.signal)
      .catch(onFailure)
      .finally(() => {
        if (epoch === this.epoch) {
          this.abortController = null
          this.inFlight = null
          onFinished()
        }
      })
  }

  reset(): void {
    this.retryAttempt = 0
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  resetRetryAttempts(): void {
    this.retryAttempt = 0
  }

  scheduleInitial(maximumDelayMs: number, canRun: () => boolean, action: () => void): void {
    this.timer = scheduleHiveRuntimeCloudInitialPhase(
      maximumDelayMs,
      this.random,
      canRun,
      this.beforeAction(action)
    )
  }

  scheduleHeartbeat(delayMs: number, canRun: () => boolean, action: () => void): void {
    this.retryAttempt = 0
    this.timer = scheduleHiveRuntimeCloudHeartbeat(
      delayMs,
      this.random,
      canRun,
      this.beforeAction(action)
    )
  }

  scheduleRetry(error: unknown, canRun: () => boolean, action: () => void): void {
    this.timer = schedulePresenceRetry(
      this.retryAttempt++,
      this.random,
      canRun,
      this.beforeAction(action),
      error
    )
  }

  private beforeAction(action: () => void): () => void {
    return () => {
      this.timer = undefined
      action()
    }
  }
}
