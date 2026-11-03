import { describe, expect, it } from 'vitest'
import { createOrcaI18n } from './orca-i18n-instance'
import {
  parsePluginLanguagePackArtifact,
  pluginLanguageResourceId,
  validatePluginLanguagePackCatalog
} from './plugins/artifacts/plugin-language-pack-artifact'

describe('current Hive translation boundary', () => {
  it('brands static defaults and catalogs before interpolating user values', () => {
    const instance = createOrcaI18n({
      loadCatalog: () => undefined,
      englishResources: { named: 'Orca opens {{path}}', command: 'Run orca serve' }
    })
    const path = '/home/Orca/user-authored/orca'
    expect(instance.translate('named', 'unused', { path })).toBe(`HiveCode opens ${path}`)
    expect(instance.translate('missing', 'Orca opens {{path}}', { path })).toBe(
      `HiveCode opens ${path}`
    )
    expect(instance.translate('command', 'unused')).toBe('Run hive serve')
  })

  it('brands plugin catalog text without rewriting interpolated paths', async () => {
    const instance = createOrcaI18n({ loadCatalog: () => undefined, englishResources: {} })
    const id = 'plugin:hive.testing/fr' as const
    const resourceLanguage = pluginLanguageResourceId(id)
    instance.setPluginLanguagePacks([
      {
        id,
        resourceLanguage,
        pluginKey: 'hive.testing',
        locale: 'fr',
        coverage: 100,
        catalog: { message: 'Orca ouvre {{path}}' }
      }
    ])
    await instance.i18n.changeLanguage(resourceLanguage)
    expect(instance.translate('message', 'unused', { path: '/Orca/work' })).toBe(
      'HiveCode ouvre /Orca/work'
    )
  })

  it('never downgrades protected-copy validation through a tolerant argument', () => {
    const catalog = {
      auto: { components: { settings: { PluginConsentProvenance: { allow: 'Safe' } } } }
    }
    expect(
      Reflect.apply(validatePluginLanguagePackCatalog, undefined, [catalog, 'tolerant']).ok
    ).toBe(false)
    expect(
      Reflect.apply(parsePluginLanguagePackArtifact, undefined, [
        JSON.stringify(catalog),
        'tolerant'
      ]).ok
    ).toBe(false)
  })

  it('refuses language packs that relabel native consent and certificate warnings', () => {
    expect(
      validatePluginLanguagePackCatalog({
        components: { 'native-chat': { approval: { allow: 'Deny' } } }
      }).ok
    ).toBe(false)
    expect(
      validatePluginLanguagePackCatalog({ browser: { loadFailure: { title: 'Safe certificate' } } })
        .ok
    ).toBe(false)
  })

  it.each([
    { accounts: { hostSignIn: { errors: { failed: 'Signed in successfully' } } } },
    { accounts: { remoteScopeAccountsAddHere: 'This account belongs to another host' } },
    { settings: { agents: { permissionOwnDescription: 'Always approve everything' } } },
    { components: { 'native-chat': { hostPermission: { ask: 'Full access' } } } }
  ])('refuses relabeling current account authority and permission intent: %j', (catalog) => {
    expect(validatePluginLanguagePackCatalog(catalog).ok).toBe(false)
  })
})
