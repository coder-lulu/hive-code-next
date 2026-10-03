import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n, translate } from './i18n'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'
import { getAgentAwakeDescription } from '../components/settings/agent-awake-copy'

const catalogs = { en, es, fr, ja, ko, zh }
const settingsDirectory = fileURLToPath(new URL('../components/settings/', import.meta.url))
const sources = readdirSync(settingsDirectory).filter(
  (name) =>
    (/^Agent.*\.tsx$/.test(name) && !name.includes('.test.')) ||
    [
      'agents-settings-navigation.ts',
      'use-agent-versions.ts',
      'agents-search.ts',
      'settings-capability-section-renderers.tsx'
    ].includes(name)
)
const usedKeys = [
  ...new Set(
    sources.flatMap(
      (name) =>
        readFileSync(`${settingsDirectory}/${name}`, 'utf8').match(
          /agentsSettings\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*/g
        ) ?? []
    )
  )
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

function placeholders(value: string): string[] {
  return (value.match(/\{\{[^}]+\}\}/g) ?? []).sort()
}

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('agent settings locales', () => {
  it('retains the agent and platform values in the interpolated labels', () => {
    expect(placeholders(lookup(en, 'agentsSettings.configureAgent') ?? '')).toEqual(['{{agent}}'])
    expect(placeholders(lookup(en, 'agentsSettings.configurationTitle') ?? '')).toEqual([
      '{{agent}}'
    ])
    expect(placeholders(lookup(en, 'agentsSettings.localEnvironment') ?? '')).toEqual([
      '{{platform}}'
    ])
  })

  it.each(Object.entries(catalogs))(
    'covers active agent settings copy in %s',
    (_locale, catalog) => {
      expect(usedKeys.length).toBeGreaterThan(35)
      expect(usedKeys.filter((key) => !lookup(catalog, key))).toEqual([])
      expect(lookup(catalog, 'agentsSettings.environmentUnavailable')).toContain('WSL')
    }
  )

  it.each(Object.entries(catalogs))('preserves interpolation tokens in %s', (_locale, catalog) => {
    for (const key of usedKeys) {
      expect(placeholders(lookup(catalog, key) ?? ''), key).toEqual(
        placeholders(lookup(en, key) ?? '')
      )
    }
  })

  it('uses the designer terminology for the three Chinese tabs and actions', async () => {
    await i18n.changeLanguage('zh')
    expect(translate('agentsSettings.manage', 'Agent management')).toBe('智能体管理')
    expect(translate('agentsSettings.preferences', 'Run preferences')).toBe('运行偏好')
    expect(translate('agentsSettings.advanced', 'Advanced configuration')).toBe('高级配置')
    expect(translate('agentsSettings.launchConfiguration', 'Launch configuration')).toBe('启动配置')
    expect(translate('agentsSettings.setDefault', 'Set as default')).toBe('设为默认')
    expect(translate('agentsSettings.currentEnvironment', 'Current environment')).toBe('当前环境')
    expect(translate('agentsSettings.upToDate', 'Latest version')).toBe('已是最新版本')
    expect(
      translate('agentsSettings.configurationTitle', '{{agent}} launch configuration', {
        agent: 'Codex'
      })
    ).toBe('Codex 启动配置')
  })

  it('localizes the reused awake descriptions and preserves their platform boundary', async () => {
    await i18n.changeLanguage('zh')
    const windows = getAgentAwakeDescription('Windows')
    const linux = getAgentAwakeDescription('Linux')
    expect(windows).toContain('智能体')
    expect(windows).toContain('电源设置')
    expect(windows).not.toContain('Choose On')
    expect(windows).not.toContain('HiveCode')
    expect(linux).toContain('HiveCode')
    expect(linux).toContain('电源策略')
    expect(linux).not.toContain('Choose On')
  })

  it('preserves the exact Chinese design copy for status and installation boundaries', () => {
    expect(zh.agentsSettings.description).toBe('管理编码智能体与启动偏好')
    expect(zh.agentsSettings.notDetected).toBe('当前环境中尚未检测到')
    expect(zh.agentsSettings.updateAvailable).toBe('可更新')
    expect(zh.agentsSettings.currentVersionFailed).toBe('未能读取')
    expect(zh.agentsSettings.latestVersionFailed).toBe('暂未获取')
    expect(zh.agentsSettings.unsupportedVersion).toBe('暂不支持')
    expect(zh.agentsSettings.installPreferenceHint).toBe(
      '控制安装后是否可被选择，不会执行安装或卸载。'
    )
  })
})
