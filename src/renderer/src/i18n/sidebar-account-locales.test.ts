import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'

const localizedCatalogs = { es, fr, ja, ko, zh }

function interpolationTokens(value: string): string[] {
  return (value.match(/\{\{[^}]+\}\}/g) ?? []).sort()
}

describe('sidebar account locale copy', () => {
  it.each(Object.entries(localizedCatalogs))(
    '%s covers every compact account-menu key with matching interpolation',
    (locale, catalog) => {
      const english = en.components.sidebarAccount
      const localized = catalog.components.sidebarAccount

      expect(Object.keys(localized).sort(), locale).toEqual(Object.keys(english).sort())
      for (const [key, englishValue] of Object.entries(english)) {
        const localizedValue = localized[key as keyof typeof localized]
        expect(localizedValue?.trim(), `${locale}:${key}`).not.toBe('')
        expect(interpolationTokens(localizedValue ?? ''), `${locale}:${key}`).toEqual(
          interpolationTokens(englishValue)
        )
      }
    }
  )

  it.each(Object.entries(localizedCatalogs))(
    '%s localizes the visible account and computer-ownership surfaces',
    (locale, catalog) => {
      const english = en.components.sidebarAccount
      const localized = catalog.components.sidebarAccount

      for (const key of [
        'accountCenter',
        'devicesSessions',
        'appearance',
        'checkUpdates',
        'restart',
        'claimComputer',
        'computerClaimedElsewhere',
        'retryComputerAnalysis'
      ] as const) {
        expect(localized[key], `${locale}:${key}`).not.toBe(english[key])
      }
    }
  )
})
