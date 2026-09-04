import { schedulePresenceRetry } from './hive-runtime-cloud-presence-support'

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
  private timer: NodeJS.Timeout | undefined
  private retryAttempt = 0

  constructor(private readonly random: () => number) {}

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
