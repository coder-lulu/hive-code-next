import type { HiveAccountSession } from './hive-account-session-store'

export function scheduleHiveAccountRefresh(
  current: NodeJS.Timeout | undefined,
  session: HiveAccountSession,
  retryDelay: number | undefined,
  refresh: () => void
): NodeJS.Timeout | undefined {
  if (current) {
    clearTimeout(current)
  }
  if (session.sessionExpiresAt <= Date.now()) {
    return undefined
  }
  const delay = retryDelay ?? Math.max(0, session.expiresAt - Date.now() - 60_000)
  const timer = setTimeout(refresh, Math.min(delay, 2_147_000_000))
  timer.unref?.()
  return timer
}
