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

describe('desktop home locale copy', () => {
  const english = flattenStrings(en.components.desktopHome)

  it.each(Object.entries(localizedCatalogs))(
    '%s covers every desktop-home key with matching interpolation',
    (locale, catalog) => {
      const localized = flattenStrings(catalog.components.desktopHome)

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
    '%s localizes the primary home-screen surfaces instead of falling back to English',
    (locale, catalog) => {
      const localized = flattenStrings(catalog.components.desktopHome)
      for (const key of [
        'sceneCode',
        'placeholderCode',
        'capability.analyzeCode',
        'spaces',
        'manageProjects',
        'noProjects',
        'composer.temporarySession',
        'composer.taskTypeCode',
        'composer.taskModeTask',
        'composer.qualityBalanced',
        'composer.permissionDefault',
        'composer.permissionUnsupported',
        'composer.contextFile'
      ]) {
        expect(localized.get(key), `${locale}:${key}`).not.toBe(english.get(key))
      }
    }
  )
})
