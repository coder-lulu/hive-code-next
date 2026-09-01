const MAX_TIMER_DELAY_MS = 2_147_483_647

export class HiveAccountRuntimeRelayAuthorizationDeadline {
  private expiresAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly now: () => number,
    private readonly onExpired: () => void
  ) {}

  start(relayExpiresAt: number, intentExpiresAt: number): boolean {
    this.clear()
    const expiresAt = Math.min(relayExpiresAt, intentExpiresAt)
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.now()) {
      return false
    }
    this.expiresAt = expiresAt
    this.arm()
    return true
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.expiresAt = 0
  }

  private arm(): void {
    const remaining = this.expiresAt - this.now()
    if (remaining <= 0) {
      this.onExpired()
      return
    }
    this.timer = setTimeout(
      () => {
        this.timer = null
        this.arm()
      },
      Math.min(remaining, MAX_TIMER_DELAY_MS)
    )
    this.timer.unref?.()
  }
}
