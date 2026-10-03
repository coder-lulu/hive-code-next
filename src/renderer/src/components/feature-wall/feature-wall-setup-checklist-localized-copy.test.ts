import { describe, expect, it } from 'vitest'
import { FEATURE_WALL_SETUP_STEPS } from '../../../../shared/feature-wall-setup-steps'
import { getLocalizedFeatureWallSetupChecklistCopy } from './feature-wall-setup-checklist-localized-copy'
import en from '../../i18n/locales/en.json'
import es from '../../i18n/locales/es.json'
import ja from '../../i18n/locales/ja.json'
import ko from '../../i18n/locales/ko.json'
import zh from '../../i18n/locales/zh.json'

const localizedCatalogs = { es, ja, ko, zh }

describe('feature-wall-setup-checklist-localized-copy', () => {
  it('returns non-empty localized name and description for all setup checklist steps', () => {
    for (const step of FEATURE_WALL_SETUP_STEPS) {
      const localized = getLocalizedFeatureWallSetupChecklistCopy(step)
      expect(localized.name).toBeTruthy()
      expect(localized.description).toBeTruthy()
    }
  })

  it.each(Object.entries(localizedCatalogs))(
    'has valid %s catalog entries for every setup checklist step',
    (_locale, catalog) => {
      const enKeys = en.auto.components.feature.wall.feature.wall.setup.checklist.localized.copy
      const localizedKeys =
        catalog.auto.components.feature.wall.feature.wall.setup.checklist.localized.copy

      // Hive keeps three legacy CLI/multitask keys alongside the sixteen active step strings.
      expect(Object.keys(enKeys)).toHaveLength(19)
      expect(Object.keys(localizedKeys).sort()).toEqual(Object.keys(enKeys).sort())
      for (const [hash, englishValue] of Object.entries(enKeys)) {
        const localizedValue = (localizedKeys as Record<string, string>)[hash]
        expect(localizedValue).toBeTruthy()
        expect(localizedValue).not.toBe(englishValue)
      }
    }
  )
})
