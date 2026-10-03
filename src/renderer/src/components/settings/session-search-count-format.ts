/**
 * Counts for the session-search status sentences.
 *
 * Sessions keep their grouping separators because a user recognises their own
 * transcript count; messages run to millions, where the exact figure carries
 * nothing the compact form does not.
 */
import { getIntlLocale } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

const getFormatters = createLocalizedCatalog(() => ({
  sessions: new Intl.NumberFormat(getIntlLocale(), { useGrouping: true }),
  messages: new Intl.NumberFormat(getIntlLocale(), {
    notation: 'compact',
    maximumFractionDigits: 1
  })
}))

export function formatSessionCount(sessions: number): string {
  return getFormatters().sessions.format(Math.max(0, Math.trunc(sessions)))
}

export function formatMessageCount(messages: number): string {
  return getFormatters().messages.format(Math.max(0, Math.trunc(messages)))
}
