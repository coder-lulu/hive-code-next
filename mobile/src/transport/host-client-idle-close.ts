// Retain healthy sockets across navigation gaps without retaining unused hosts indefinitely.
export class HostClientIdleClose {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  schedule(hostId: string, close: () => void): void {
    if (this.timers.has(hostId)) {
      return
    }
    this.timers.set(
      hostId,
      setTimeout(() => {
        this.timers.delete(hostId)
        close()
      }, 20_000)
    )
  }

  cancel(hostId: string): void {
    const timer = this.timers.get(hostId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.timers.delete(hostId)
    }
  }

  cancelAll(): void {
    for (const hostId of this.timers.keys()) {
      this.cancel(hostId)
    }
  }
}
