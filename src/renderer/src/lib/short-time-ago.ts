import { translate } from '@/i18n/i18n'
import { formatCompactDuration } from './agent-row-decay-state'

/** Compact "now / 5m / 3h / 2d" age label shared by agent rows and activity threads. */
export function formatShortTimeAgo(ts: number, now = Date.now()): string {
  const delta = now - ts
  if (delta < 60_000) {
    return translate('components.agentStatus.now', 'now')
  }
  return formatCompactDuration(delta)
}
