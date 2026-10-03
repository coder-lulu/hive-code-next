import { afterAll, describe, expect, it } from 'vitest'
import { i18n, setRendererPluginLanguagePacks, translate } from '@/i18n/i18n'
import { pluginLanguageResourceId } from '../../../../shared/plugins/plugin-language-pack-artifact'
import { getAgentsPaneSearchEntries } from './agents-search'
import { matchesSettingsSearch } from './settings-search'

const queries = {
  en: { mirror: 'mirror', arguments: 'arguments', environment: 'environment' },
  es: { mirror: 'espejo', arguments: 'argumentos', environment: 'entorno' },
  fr: { mirror: 'miroir', arguments: 'arguments', environment: 'environnement' },
  ja: { mirror: 'ミラー', arguments: '引数', environment: '環境' },
  ko: { mirror: '미러', arguments: '인수', environment: '환경' },
  zh: { mirror: '镜像', arguments: '参数', environment: '环境' }
}

describe('agent settings localized search', () => {
  afterAll(async () => {
    setRendererPluginLanguagePacks([])
    await i18n.changeLanguage('en')
  })

  it.each(Object.entries(queries))(
    'finds package sources and launch configuration in %s',
    async (locale, query) => {
      await i18n.changeLanguage(locale)
      const entries = getAgentsPaneSearchEntries()
      const packageSource = entries.find((entry) => entry.targetSectionId === 'agent-npm-registry')!
      const advanced = entries.find((entry) => entry.targetSectionId === 'agent-configuration')!
      const codex = entries.find((entry) => entry.targetSectionId === 'agent-config-codex')!
      expect(matchesSettingsSearch(query.mirror, packageSource)).toBe(true)
      for (const field of [query.arguments, query.environment, 'arguments', 'environment']) {
        expect(matchesSettingsSearch(field, advanced)).toBe(true)
        expect(matchesSettingsSearch(`Codex ${field}`, codex)).toBe(true)
      }
      expect(matchesSettingsSearch('npm', packageSource)).toBe(true)
    }
  )

  it('refreshes search entries when the selected plugin catalog is replaced', async () => {
    const id = 'plugin:review.settings/fr' as const
    const pack = {
      id,
      resourceLanguage: pluginLanguageResourceId(id),
      pluginKey: 'review.settings',
      locale: 'fr',
      catalog: { agentsSettings: { packageSource: 'Ancienne source' } }
    }
    setRendererPluginLanguagePacks([pack])
    await i18n.changeLanguage(pack.resourceLanguage)
    const packageSource = () =>
      getAgentsPaneSearchEntries().find((entry) => entry.targetSectionId === 'agent-npm-registry')
    expect(packageSource()?.title).toBe('Ancienne source')

    setRendererPluginLanguagePacks([
      { ...pack, catalog: { agentsSettings: { packageSource: 'Nouvelle source' } } }
    ])
    await i18n.changeLanguage(pack.resourceLanguage)

    expect(translate('agentsSettings.packageSource', 'Package source')).toBe('Nouvelle source')
    expect(packageSource()?.title).toBe('Nouvelle source')
  })
})
