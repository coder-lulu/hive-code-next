import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'

const localizedCatalogs = { es, ja, ko, zh }
const sourceDirectory = fileURLToPath(new URL('../components/settings/', import.meta.url))
const settingsSource = readFileSync(`${sourceDirectory}/Settings.tsx`, 'utf8')
const settingsSidebarSource = readFileSync(`${sourceDirectory}/SettingsSidebar.tsx`, 'utf8')

const sourceFiles = [
  'HiveAccountSettingsPane.tsx',
  'HiveAccountSettingsContent.tsx',
  'HiveAccountSignedOutState.tsx',
  'HiveAccountSecuritySection.tsx',
  'HiveAccountSignInConfirmDialog.tsx',
  'HiveAccountSignOutConfirmDialog.tsx',
  'HiveRuntimeSessionsSettings.tsx',
  'hive-account-runtime-presentation.ts',
  'hive-account-settings-view.ts',
  'orca-account-settings-search.ts',
  'AutomationsSettingsPane.tsx',
  'automations-settings-search.ts',
  'ArtifactsSettingsPane.tsx',
  'artifacts-settings-search.ts',
  'ShareSkillsSettingsPane.tsx',
  'share-skills-settings-search.ts'
] as const

const namespacePattern =
  /(?:auto\.components\.settings\.(?:orcaAccount|runtimeSessions|automations|artifacts|shareSkills)|components\.hiveAccountSignIn)\.[A-Za-z0-9]+/g

const navigationKeys = [
  'auto.hooks.useSettingsNavigationMetadata.automationsTitle',
  'auto.hooks.useSettingsNavigationMetadata.automationsDescription',
  'auto.hooks.useSettingsNavigationMetadata.artifactsTitle',
  'auto.hooks.useSettingsNavigationMetadata.artifactsDescription',
  'auto.hooks.useSettingsNavigationMetadata.shareSkillsTitle',
  'auto.hooks.useSettingsNavigationMetadata.shareSkillsDescription'
] as const

const settingsSidebarKeys = [
  'auto.components.setup.guide.SetupGuideProgressRing.dac3a4724a',
  'auto.components.skills.SkillFreshnessStatusPill.updateAvailable',
  'auto.components.skills.SkillFreshnessStatusPill.upToDate',
  'auto.components.skills.SkillFreshnessStatusPill.installed',
  'auto.components.skills.SkillFreshnessStatusPill.details',
  'auto.components.skills.SkillFreshnessStatusPill.needsAttention',
  'auto.components.skills.SkillFreshnessStatusPill.checking',
  'auto.components.skills.SkillFreshnessStatusPill.checkFailed'
] as const

const usedKeys = [
  ...new Set(
    sourceFiles.flatMap((file) => {
      const source = readFileSync(`${sourceDirectory}/${file}`, 'utf8')
      return source.match(namespacePattern) ?? []
    })
  ),
  ...navigationKeys,
  ...settingsSidebarKeys
].sort()

function lookup(catalog: unknown, key: string): string | undefined {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      catalog
    )
  return typeof value === 'string' ? value : undefined
}

function interpolationTokens(value: string): string[] {
  return (value.match(/\{\{[^}]+\}\}/g) ?? []).sort()
}

describe('cloud-feature settings locale copy', () => {
  it('tracks every translation key used by the covered settings surfaces', () => {
    expect(usedKeys.length).toBeGreaterThan(180)
  })

  it('does not leave English-only Beta badges in the settings content headers', () => {
    expect(settingsSource).not.toContain('badge="Beta"')
  })

  it('localizes the setup progress shown in the settings sidebar', () => {
    expect(settingsSidebarSource).not.toContain(
      '`${progress.doneCount}/${progress.total} complete`'
    )
    expect(settingsSidebarSource).toContain(
      'auto.components.setup.guide.SetupGuideProgressRing.dac3a4724a'
    )
  })

  it.each(Object.entries({ en, ...localizedCatalogs }))(
    '%s covers every account, automation, artifact, and shared-skill settings key',
    (locale, catalog) => {
      for (const key of usedKeys) {
        const english = lookup(en, key)
        const localized = lookup(catalog, key)

        expect(english, `en:${key}`).toBeDefined()
        expect(localized, `${locale}:${key}`).toBeDefined()
        expect(english?.trim(), `en:${key}`).not.toBe('')
        expect(localized?.trim(), `${locale}:${key}`).not.toBe('')
        expect(interpolationTokens(localized ?? ''), `${locale}:${key}`).toEqual(
          interpolationTokens(english ?? '')
        )
      }
    }
  )

  it.each(Object.entries(localizedCatalogs))(
    '%s localizes the primary visible settings labels instead of falling back to English',
    (locale, catalog) => {
      for (const key of [
        'auto.components.settings.orcaAccount.title',
        'auto.components.settings.orcaAccount.description',
        'auto.components.settings.orcaAccount.sessionExpires',
        'auto.components.settings.runtimeSessions.title',
        'auto.components.settings.runtimeSessions.loadFailed',
        'auto.components.settings.automations.title',
        'auto.components.settings.artifacts.title',
        'auto.components.settings.shareSkills.title',
        'auto.hooks.useSettingsNavigationMetadata.automationsTitle',
        'auto.hooks.useSettingsNavigationMetadata.artifactsTitle',
        'auto.hooks.useSettingsNavigationMetadata.shareSkillsTitle',
        'auto.hooks.useSettingsNavigationMetadata.b35e92364b',
        'auto.hooks.useSettingsNavigationMetadata.pluginsTitle',
        'auto.components.skills.SkillFreshnessStatusPill.details',
        'auto.components.skills.SkillFreshnessStatusPill.needsAttention'
      ]) {
        expect(lookup(catalog, key), `${locale}:${key}`).not.toBe(lookup(en, key))
      }
    }
  )
})
