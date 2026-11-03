import { describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { prepareLoadedTerminalSettings } from './prepare-loaded-terminal-settings'
import { prepareLoadedProfileSettings } from './prepare-loaded-profile-settings'
import { normalizeLoadedGlobalSettings } from './normalize-loaded-global-settings'

function load(overrides: Record<string, unknown>) {
  const parsed = getDefaultPersistedState('/hive-current-profile')
  Object.assign(parsed.settings, overrides)
  for (const key of Object.keys(parsed.settings)) {
    if (/Migrated|Defaulted/.test(key)) {
      Reflect.deleteProperty(parsed.settings, key)
    }
  }
  const terminal = prepareLoadedTerminalSettings(parsed, () => {})
  const profile = prepareLoadedProfileSettings(parsed, terminal.defaults, () => {})
  return normalizeLoadedGlobalSettings(parsed, terminal, profile)
}

describe('one current settings load policy', () => {
  it('loads only valid Dashboard cursors and current consent fields', () => {
    expect(
      load({
        telemetry: {
          optedIn: false,
          installId: 'persisted-install',
          existedBeforeTelemetryRelease: true,
          agentDashboardActiveDays: { in_window: 20_000, popout: -1, privateField: 1 }
        }
      }).telemetry
    ).toEqual({
      optedIn: false,
      installId: 'persisted-install',
      agentDashboardActiveDays: { in_window: 20_000 }
    })
  })

  it('migrates valid saved launch defaults once while current actions take precedence', () => {
    const parsed = getDefaultPersistedState('/hive-current-profile')
    if (!parsed.settings.sourceControlAi) {
      throw new Error('Default persisted settings must include source control AI settings')
    }
    parsed.settings.sourceControlAi.actions = { fixChecks: { agentId: 'codex' } }
    Reflect.set(parsed.settings.sourceControlAi, 'launchActionDefaults', {
      fixChecks: { agentId: 'claude' },
      resolveComments: { agentId: 'claude', agentArgs: '--dangerously-skip-permissions' },
      unknownAction: { agentId: 'claude' }
    })
    let saves = 0
    const terminal = prepareLoadedTerminalSettings(parsed, () => {
      saves += 1
    })
    expect(terminal.settings.sourceControlAi.actions?.fixChecks?.agentId).toBe('codex')
    expect(terminal.settings.sourceControlAi.actions?.resolveComments?.agentId).toBe('claude')
    expect(terminal.settings.sourceControlAi.actions).not.toHaveProperty('unknownAction')
    expect(terminal.settings.sourceControlAi).not.toHaveProperty('launchActionDefaults')
    expect(saves).toBeGreaterThan(0)
  })

  it('shows completed artifact navigation by default while keeping publication consent separate', () => {
    expect(load({})).toMatchObject({
      showArtifactsButton: true,
      showSkillsButton: true,
      artifactSharingEnabled: false
    })
    expect(load({ showArtifactsButton: false }).showArtifactsButton).toBe(false)
    expect(load({ showSkillsButton: false }).showSkillsButton).toBe(false)
  })

  it('keeps only explicit current agent view choices without granting support', () => {
    const settings = load({
      nativeChatProviders: {
        claude: true,
        codex: false,
        opencode: 'enabled',
        unknownAgent: true
      }
    })
    expect(settings.nativeChatProviders).toEqual({ claude: true, codex: false })
  })

  it('preserves explicit current preferences without historical stamps', () => {
    const settings = load({
      terminalMacOptionAsAlt: 'true',
      terminalTuiScrollSensitivity: 3,
      terminalAllowOsc52Clipboard: false,
      floatingTerminalEnabled: false,
      autoRenameBranchFromWork: false,
      terminalCursorStyle: 'bar',
      localAccountRuntime: 'host',
      visibleTaskProviders: ['github'],
      disabledTuiAgents: []
    })
    expect(settings).toMatchObject({
      terminalMacOptionAsAlt: 'true',
      terminalTuiScrollSensitivity: 3,
      terminalAllowOsc52Clipboard: false,
      floatingTerminalEnabled: false,
      autoRenameBranchFromWork: false,
      terminalCursorStyle: 'bar',
      localAccountRuntime: 'host',
      visibleTaskProviders: ['github'],
      disabledTuiAgents: []
    })
  })

  it('does not accept retired bytes, secrets or feature fields into current output', () => {
    const current = load({ terminalScrollbackRows: 3210 })
    const settings = load({
      terminalScrollbackRows: 3210,
      terminalScrollbackBytes: 1,
      opencodeGoApiKey: 'retired-key-fixture',
      experimentalSidekick: true
    })
    expect(settings.terminalScrollbackRows).toBe(current.terminalScrollbackRows)
    for (const key of ['terminalScrollbackBytes', 'opencodeGoApiKey', 'experimentalSidekick']) {
      expect(Object.hasOwn(settings, key), key).toBe(false)
    }
    expect(Object.keys(settings).filter((key) => /Migrated|Defaulted/.test(key))).toEqual([])
  })

  it('does not derive a trust grant from a saved workspace directory', () => {
    const settings = load({
      floatingTerminalCwd: '/unapproved-workspace',
      floatingTerminalTrustedCwds: []
    })
    expect(settings.floatingTerminalTrustedCwds).toEqual([])
  })
})
