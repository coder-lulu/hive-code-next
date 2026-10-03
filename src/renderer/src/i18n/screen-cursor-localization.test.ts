import { afterEach, describe, expect, it } from 'vitest'
import { COLOR_OVERRIDE_GROUPS } from '@/components/settings/terminal-window-color-groups'
import { i18n, translate } from './i18n'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('screen cursor localization', () => {
  it('uses the Chinese screen cursor label in terminal settings and onboarding', async () => {
    const cursor = COLOR_OVERRIDE_GROUPS.flatMap((group) => group.keys).find(
      (setting) => setting.key === 'cursor'
    )
    expect(cursor).toBeDefined()

    for (const [locale, label] of [
      ['zh', '光标'],
      ['ja', 'カーソル'],
      ['zh', '光标'],
      ['en', 'Cursor']
    ]) {
      await i18n.changeLanguage(locale)
      expect(cursor?.label).toBe(label)
      expect(translate('auto.components.onboarding.ThemeStep.ab2a583a97', 'Cursor')).toBe(label)
    }
  })
})
