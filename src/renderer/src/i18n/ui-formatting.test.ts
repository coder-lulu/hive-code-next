import { afterEach, expect, it } from 'vitest'
import { i18n, setRendererPluginLanguagePacks } from './i18n'
import { formatAbsoluteDate } from '@/components/activity/activity-thread-presentation'
import { formatAutomationDateTime } from '@/components/automations/automation-page-parts'
import { formatAutomationTokens } from '@/components/automations/automation-usage-model'
import { formatGitHistoryTimestamp } from '@/components/right-sidebar/source-control/sync/git-history-format'
import { getWorkspaceSpaceScanDateTimeLabel } from '@/components/status-bar/workspace-space-format'
import { formatSessionTime } from '@/components/stats/usage-formatters'
import { pluginLanguageResourceId } from '../../../shared/plugins/plugin-language-pack-artifact'

afterEach(async () => {
  setRendererPluginLanguagePacks([])
  await i18n.changeLanguage('en')
})

it('updates cached dates throughout the UI after switching languages', async () => {
  const timestamp = Date.UTC(2026, 9, 3, 13, 24)
  const timeOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  } as const

  for (const locale of ['en', 'fr']) {
    await i18n.changeLanguage(locale)
    expect(formatAbsoluteDate(timestamp)).toBe(
      new Intl.DateTimeFormat(locale, { ...timeOptions, year: 'numeric' }).format(timestamp)
    )
    expect(formatAutomationDateTime(timestamp)).toBe(
      new Intl.DateTimeFormat(locale, timeOptions).format(timestamp)
    )
    expect(formatGitHistoryTimestamp(timestamp)).toBe(
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'long' }).format(timestamp)
    )
    expect(getWorkspaceSpaceScanDateTimeLabel(timestamp)).toBe(
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
    )
    expect(formatSessionTime(new Date(timestamp).toISOString())).toBe(
      new Date(timestamp).toLocaleString(locale, timeOptions)
    )
  }
})

it('formats plugin dates and fractional counts using the declared locale', async () => {
  const id = 'plugin:review.ui-formatting/fr-FR' as const
  const resourceLanguage = pluginLanguageResourceId(id)
  setRendererPluginLanguagePacks([
    { id, resourceLanguage, pluginKey: 'review.ui-formatting', locale: 'fr-FR', catalog: {} }
  ])
  await i18n.changeLanguage(resourceLanguage)
  const timestamp = Date.UTC(2026, 9, 3, 13, 24)
  expect(formatGitHistoryTimestamp(timestamp)).toBe(
    new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'long' }).format(timestamp)
  )
  expect(formatAutomationTokens(123.5)).toBe(new Intl.NumberFormat('fr-FR').format(123.5))
  expect(formatSessionTime('invalid date')).toBe('invalid date')
  expect(formatGitHistoryTimestamp(Number.NaN)).toBe('')
})
