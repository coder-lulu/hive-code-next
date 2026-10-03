import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import en from '../../src/renderer/src/i18n/locales/en.json'
import es from '../../src/renderer/src/i18n/locales/es.json'
import fr from '../../src/renderer/src/i18n/locales/fr.json'
import ja from '../../src/renderer/src/i18n/locales/ja.json'
import ko from '../../src/renderer/src/i18n/locales/ko.json'
import zh from '../../src/renderer/src/i18n/locales/zh.json'

test.use({ seedTestRepo: false })

test('switches among all built-in languages and searches agent launch settings', async ({
  orcaPage: page
}, testInfo) => {
  await page.setViewportSize({ width: 1250, height: 950 })
  for (const [locale, catalog] of Object.entries({ en, es, fr, ja, ko, zh })) {
    await page.evaluate(async (locale) => {
      const state = window.__store!.getState()
      state.setSettingsSearchQuery('')
      await state.updateSettings({
        uiLanguage: locale as 'en' | 'es' | 'fr' | 'ja' | 'ko' | 'zh',
        theme: locale === 'fr' || locale === 'ko' ? 'dark' : 'light'
      })
      state.openSettingsTarget({ pane: 'agents', repoId: null })
      state.openSettingsPage()
    }, locale)
    const settings = page.locator('[data-settings-section="agents"]')
    const advanced = settings.getByRole('tab', {
      name: catalog.agentsSettings.advanced,
      exact: true
    })
    await expect(advanced).toBeVisible()
    const awakeCopy = catalog.auto.components.status.bar.CaffeinateStatusSegment
    const awakeLabel = awakeCopy.ariaLabel
      .replace('{{title}}', catalog.auto.components.settings['agent-awake-copy'].modeTitle)
      .replace(
        '{{status}}',
        `${catalog.auto.components.settings.AgentAwakeSetting.off} · ${awakeCopy.inactive}`
      )
    await expect(page.getByRole('button', { name: awakeLabel, exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: catalog.auto.components.settings.orcaAccount.title,
        exact: true
      })
    ).toBeVisible()
    await settings.getByRole('tab', { name: catalog.agentsSettings.manage, exact: true }).click()
    const search = page.getByPlaceholder(
      catalog.auto.components.settings.SettingsSidebar.dbceaa8840,
      {
        exact: true
      }
    )
    for (const query of [catalog.agentsSettings.search.arguments, 'arguments']) {
      await search.fill(query)
      await expect(advanced).toHaveAttribute('aria-selected', 'true')
      await expect(search).toBeFocused()
      await search.clear()
    }
    await page.screenshot({
      path: path.join(testInfo.outputDir, `settings-${locale}.png`),
      animations: 'disabled'
    })
  }
})
