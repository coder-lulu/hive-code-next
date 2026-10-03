import { afterEach, expect, it } from 'vitest'
import { i18n, setRendererPluginLanguagePacks } from '@/i18n/i18n'
import { pluginLanguageResourceId } from '../../../../shared/plugins/plugin-language-pack-artifact'
import { formatAccountTimestamp } from './accounts-pane-runtime'
import { formatSessionCount, formatMessageCount } from './session-search-count-format'
import { formatSparsePresetUpdatedAt } from './sparse-preset-date'

afterEach(async () => {
  setRendererPluginLanguagePacks([])
  await i18n.changeLanguage('en')
})

it('updates number grouping and compact units when the UI language changes', async () => {
  await i18n.changeLanguage('en')
  expect(formatSessionCount(1234)).toBe(new Intl.NumberFormat('en').format(1234))
  await i18n.changeLanguage('fr')
  expect(formatSessionCount(1234)).toBe(new Intl.NumberFormat('fr').format(1234))
  expect(formatMessageCount(1234567)).toBe(
    new Intl.NumberFormat('fr', { notation: 'compact', maximumFractionDigits: 1 }).format(1234567)
  )
})

it('formats account and preset dates in the selected UI language', async () => {
  const timestamp = Date.UTC(2026, 9, 3, 13, 24)
  await i18n.changeLanguage('fr')
  expect(formatAccountTimestamp(timestamp)).toBe(
    new Date(timestamp).toLocaleString('fr', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  )
  expect(formatSparsePresetUpdatedAt(timestamp)).toBe(
    new Intl.DateTimeFormat('fr', { month: 'short', day: 'numeric', year: 'numeric' }).format(
      timestamp
    )
  )
})

it('uses a plugin locale instead of passing its synthetic language ID to Intl', async () => {
  const id = 'plugin:review.formatting/fr-FR' as const
  const resourceLanguage = pluginLanguageResourceId(id)
  setRendererPluginLanguagePacks([
    { id, resourceLanguage, pluginKey: 'review.formatting', locale: 'fr-FR', catalog: {} }
  ])
  await i18n.changeLanguage(resourceLanguage)
  expect(formatSessionCount(1234)).toBe(new Intl.NumberFormat('fr-FR').format(1234))
})
