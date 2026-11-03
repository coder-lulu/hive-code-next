import { EPHEMERAL_DEVICE_SWEEP_INTERVAL_MS } from '../ephemeral-device-rows'
import type { DeviceRegistry } from '../device-registry'

/** The socket owner keeps live browser keys; abandoned session-only rows expire. */
export function createMobileEphemeralDeviceSweep(
  registry: DeviceRegistry,
  isLive: (deviceId: string) => boolean,
  terminate: (deviceId: string) => void
): { sweep: (now: number) => string[]; dispose: () => void } {
  let disposed = false
  function sweep(now: number): string[] {
    if (disposed) {
      return []
    }
    let removed: string[]
    try {
      removed = registry.pruneIdleEphemeralDevices(now, isLive)
    } catch (error) {
      console.error('[mobile] Failed to prune idle browser-session devices:', error)
      return []
    }
    for (const deviceId of removed) {
      terminate(deviceId)
    }
    return removed
  }
  const timer = setInterval(() => sweep(Date.now()), EPHEMERAL_DEVICE_SWEEP_INTERVAL_MS)
  timer.unref?.()
  return {
    sweep,
    dispose: () => {
      disposed = true
      clearInterval(timer)
    }
  }
}
