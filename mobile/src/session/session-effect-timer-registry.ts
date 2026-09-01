export function createEffectTimerRegistry() {
  let disposed = false
  const timers = new Set<ReturnType<typeof setTimeout>>()

  return {
    get disposed() {
      return disposed
    },
    schedule(callback: () => void, delayMs: number) {
      if (disposed) {
        return
      }
      timers.add(setTimeout(callback, delayMs))
    },
    dispose() {
      disposed = true
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }
}
