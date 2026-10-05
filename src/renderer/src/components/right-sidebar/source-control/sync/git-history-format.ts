import { getIntlLocale } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

const getGitHistoryTimestampFormatter = createLocalizedCatalog(
  () =>
    new Intl.DateTimeFormat(getIntlLocale(), {
      dateStyle: 'medium',
      timeStyle: 'long'
    })
)

export function formatGitHistoryTimestamp(timestamp: number | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) {
    return ''
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return getGitHistoryTimestampFormatter().format(date)
}
