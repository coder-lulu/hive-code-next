export function scheduleHiveRuntimeCloudHeartbeat(
  delayMs: number,
  canRun: () => boolean,
  action: () => void
): NodeJS.Timeout {
  const timer = setTimeout(() => {
    if (canRun()) {
      action()
    }
  }, delayMs)
  timer.unref?.()
  return timer
}
