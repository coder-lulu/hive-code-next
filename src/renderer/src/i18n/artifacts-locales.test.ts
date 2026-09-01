import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'

const localizedCatalogs = { es, ja, ko, zh }

function flattenStrings(value: unknown, prefix = '', entries = new Map<string, string>()) {
  if (typeof value === 'string') {
    entries.set(prefix, value)
    return entries
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return entries
  }
  for (const [key, child] of Object.entries(value)) {
    flattenStrings(child, prefix ? `${prefix}.${key}` : key, entries)
  }
  return entries
}

function interpolationTokens(value: string): string[] {
  return (value.match(/\{\{[^}]+\}\}/g) ?? []).sort()
}

describe('artifacts locale copy', () => {
  const english = flattenStrings(en.auto.components.artifacts)

  it.each(Object.entries(localizedCatalogs))(
    '%s covers every artifact key with matching interpolation',
    (locale, catalog) => {
      const localized = flattenStrings(catalog.auto.components.artifacts)

      expect([...localized.keys()].sort(), locale).toEqual([...english.keys()].sort())
      for (const [key, englishValue] of english) {
        const localizedValue = localized.get(key)
        expect(localizedValue?.trim(), `${locale}:${key}`).not.toBe('')
        expect(interpolationTokens(localizedValue ?? ''), `${locale}:${key}`).toEqual(
          interpolationTokens(englishValue)
        )
      }
    }
  )

  it.each(Object.entries(localizedCatalogs))(
    '%s translates the primary artifact surfaces instead of falling back to English',
    (locale, catalog) => {
      const localized = flattenStrings(catalog.auto.components.artifacts)
      for (const key of [
        'ArtifactsPage.title',
        'ArtifactsPage.signInHeading',
        'ArtifactsPage.empty',
        'ArtifactPublishButton.confirmTitle',
        'ArtifactPublishButton.sharePublicLink',
        'ArtifactListSearchField.placeholder'
      ]) {
        expect(localized.get(key), `${locale}:${key}`).not.toBe(english.get(key))
      }
    }
  )
})
