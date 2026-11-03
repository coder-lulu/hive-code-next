import { homedir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { normalizeLoadedGlobalSettings } from './normalize-loaded-global-settings'
import { prepareLoadedTerminalSettings } from './prepare-loaded-terminal-settings'
import { prepareLoadedProfileSettings } from './prepare-loaded-profile-settings'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { PersistedState } from '../../../shared/persisted-state-types'

function normalizeSettings(overrides: Record<string, unknown>): PersistedState['settings'] {
  const defaults = getDefaultPersistedState(homedir())
  const settings: Partial<GlobalSettings> = { ...defaults.settings }
  Object.assign(settings, overrides)
  const parsed: PersistedState = { ...defaults, settings: settings as GlobalSettings }
  const noop = (): void => {}
  const terminal = prepareLoadedTerminalSettings(parsed, noop)
  const profile = prepareLoadedProfileSettings(parsed, defaults, noop)
  return normalizeLoadedGlobalSettings(parsed, terminal, profile)
}

describe('current feature settings validation', () => {
  it('bounds untrusted plugin choices, mirror URLs and worker heartbeat intervals on load', () => {
    const settings = normalizeSettings({
      pluginAppThemeDark: 'plugin:../../untrusted',
      pluginIconTheme: 'plugin:publisher.theme/icons',
      terminalPluginPalettes: [{ id: 'invalid', colors: {} }],
      pluginUpdatePolicy: 'unbounded',
      nodeDistMirrorUrl: 'file:///untrusted',
      orchestrationHeartbeatIntervalMinutes: 0
    })
    expect(settings).toMatchObject({
      pluginAppThemeDark: null,
      pluginIconTheme: 'plugin:publisher.theme/icons',
      terminalPluginPalettes: [],
      pluginUpdatePolicy: 'manual',
      nodeDistMirrorUrl: '',
      orchestrationHeartbeatIntervalMinutes: 5
    })
  })

  it('defaults completed features on and preserves explicit opt-outs without rollout stamps', () => {
    expect(
      normalizeSettings({
        pluginSystemEnabled: undefined,
        experimentalBrowserExtensions: undefined,
        experimentalConnectors: undefined
      })
    ).toMatchObject({
      pluginSystemEnabled: true,
      experimentalBrowserExtensions: true,
      experimentalConnectors: true
    })
    const settings = normalizeSettings({
      pluginSystemEnabled: false,
      pluginSystemDefaultedOn: false,
      experimentalBrowserExtensions: false,
      experimentalConnectors: false
    })
    expect(settings).toMatchObject({
      pluginSystemEnabled: false,
      experimentalBrowserExtensions: false,
      experimentalConnectors: false
    })
    expect(settings).not.toHaveProperty('pluginSystemDefaultedOn')
  })
})

describe('persisted default agent', () => {
  it.each(['hivecode', 'managed-pi', 'unknown-agent', 42, undefined])(
    'restores %s as automatic selection',
    (defaultTuiAgent) => {
      expect(normalizeSettings({ defaultTuiAgent }).defaultTuiAgent).toBeNull()
    }
  )

  it.each(['codex', 'pi', 'blank', null])('preserves %s', (defaultTuiAgent) => {
    expect(normalizeSettings({ defaultTuiAgent }).defaultTuiAgent).toBe(defaultTuiAgent)
  })
})

describe('retired settings inputs', () => {
  it('drops retired sidebar, feature and view selectors without changing current choices', () => {
    const normalized = normalizeSettings({
      experimentalActivity: true,
      showAgentsSidebar: false,
      agentsSidebarMigratedFromExperimental: true,
      experimentalManagedServers: false,
      experimentalNativeChat: false,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: false,
      nativeChatProviders: { codex: false, claude: true }
    })
    for (const key of [
      'experimentalActivity',
      'showAgentsSidebar',
      'agentsSidebarMigratedFromExperimental',
      'experimentalManagedServers',
      'experimentalNativeChat',
      'experimentalStructuredNativeChat',
      'openAgentTabsInChatByDefault'
    ]) {
      expect(normalized).not.toHaveProperty(key)
    }
    expect(normalized.nativeChatProviders).toEqual({ codex: false, claude: true })
  })
})

describe('structured chat shell environment settings', () => {
  it('keeps a valid saved list and an explicit opt-out', () => {
    const normalized = normalizeSettings({
      nativeChatInheritShellEnvironment: false,
      nativeChatShellEnvironmentVariables: ['HTTPS_PROXY', 'CODEX_LB_API_KEY']
    })
    expect(normalized.nativeChatInheritShellEnvironment).toBe(false)
    expect(normalized.nativeChatShellEnvironmentVariables).toEqual([
      'HTTPS_PROXY',
      'CODEX_LB_API_KEY'
    ])
  })

  it('degrades a malformed hand-edited value to the defaults instead of failing a chat', () => {
    const normalized = normalizeSettings({
      nativeChatInheritShellEnvironment: 'no',
      nativeChatShellEnvironmentVariables: 'HTTPS_PROXY, CODEX_LB_API_KEY'
    })
    expect(normalized.nativeChatInheritShellEnvironment).toBe(true)
    expect(normalized.nativeChatShellEnvironmentVariables).toEqual([])
  })

  it('drops non-string and invalid entries from a saved list', () => {
    expect(
      normalizeSettings({
        nativeChatShellEnvironmentVariables: ['HTTPS_PROXY', 7, null, 'not valid', 'HTTPS_PROXY']
      }).nativeChatShellEnvironmentVariables
    ).toEqual(['HTTPS_PROXY'])
  })
})

describe('machine name setting', () => {
  it('trims persisted names and defaults missing values to automatic detection', () => {
    expect(normalizeSettings({ machineName: '  Build server  ' }).machineName).toBe('Build server')
    expect(normalizeSettings({ machineName: undefined }).machineName).toBe('')
    expect(normalizeSettings({ machineName: 'x'.repeat(300) }).machineName).toHaveLength(255)
  })
})

describe('chat appearance settings', () => {
  it('normalizes missing and malformed appearance preferences on load', () => {
    expect(normalizeSettings({}).nativeChatAppearance).toBeUndefined()
    expect(
      normalizeSettings({
        nativeChatAppearance: { fontSize: 40, codeFontSize: 1, width: 'wide' }
      }).nativeChatAppearance
    ).toEqual({ fontSize: 20, codeFontSize: 10, width: 'wide' })
    expect(
      normalizeSettings({
        nativeChatAppearance: { fontSize: 14, codeFontSize: 12, width: 'comfortable' }
      }).nativeChatAppearance
    ).toBeUndefined()
  })
})

describe('current permission preferences', () => {
  it('keeps explicit typed choices without deriving native grants from retired settings', () => {
    const normalized = normalizeSettings({
      agentPermissionDefault: 'ask',
      agentPermissionOverrides: { codex: 'own' },
      agentDefaultArgs: { claude: '--custom' },
      nativeChatPermissionMode: 'full-access',
      agentPermissionMode: 'yolo'
    })
    expect(normalized.agentPermissionDefault).toBe('ask')
    expect(normalized.agentPermissionOverrides).toEqual({ codex: 'own' })
    expect(normalized.agentDefaultArgs).toEqual({ claude: '--custom' })
    expect(normalized).not.toHaveProperty('nativeChatPermissionMode')
    expect(normalized).not.toHaveProperty('agentPermissionMode')
  })
})

describe('terminal default shell', () => {
  it('trims a hand-edited value and treats whitespace-only as unset', () => {
    expect(normalizeSettings({ terminalDefaultShell: '  /bin/zsh  ' }).terminalDefaultShell).toBe(
      '/bin/zsh'
    )
    expect(normalizeSettings({ terminalDefaultShell: '   ' }).terminalDefaultShell).toBe('')
  })
})
