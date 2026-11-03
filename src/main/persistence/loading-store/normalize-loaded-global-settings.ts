import { normalizeNativeChatAppearanceSettings } from '../../../shared/native-chat/native-chat-appearance-settings'
import { getDefaultVoiceSettings } from '../../../shared/constants'
import { normalizePRBotAuthorOverrides } from '../../../shared/pr-bot-author-overrides'
import { normalizeTerminalQuickCommands } from '../../../shared/terminal-quick-commands'
import { normalizeOpenInApplications } from '../../../shared/open-in-applications'
import { normalizeTerminalShortcutPolicy } from '../../../shared/keybindings'
import { normalizeAppIconId } from '../../../shared/app-icon'
import { normalizeTerminalCustomThemes } from '../../../shared/terminal-custom-themes'
import { normalizeTerminalDefaultShell } from '../../../shared/terminal-default-shell'
import { normalizeUiLanguage } from '../../../shared/ui-language'
import { normalizeNativeChatShellEnvironmentVariables } from '../../../shared/native-chat/native-chat-shell-environment'
import { normalizeMachineName } from '../../../shared/machine-name'
import { isTuiAgent } from '../../../shared/tui-agent-config'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { PreparedLoadedTerminalSettings } from './prepare-loaded-terminal-settings'
import type { PreparedLoadedProfileSettings } from './prepare-loaded-profile-settings'

import { pickCurrentGlobalSettings } from '../../../shared/current-global-settings'
import { expandWorkspaceDirHome } from '../applying-settings/terminal-settings-migrations'
import { normalizeNativeChatProviders } from '../../../shared/structured-native-chat-launch-route'
import { normalizePluginOwnedSettings } from '../../../shared/plugins/capabilities/plugin-owned-settings'
import { normalizeNodeDistMirrorUrl } from '../../../shared/node-dist-mirror'
import { resolveOrchestrationHeartbeatInterval } from '../../../shared/orchestration-heartbeat'
import { normalizeCurrentTelemetry } from './current-telemetry-settings'
export function normalizeLoadedGlobalSettings(
  parsed: PersistedState,
  terminal: PreparedLoadedTerminalSettings,
  profile: PreparedLoadedProfileSettings
): PersistedState['settings'] {
  const defaults = terminal.defaults
  const pluginSystemEnabled: unknown = parsed.settings?.pluginSystemEnabled
  const settings = {
    ...defaults.settings,
    ...expandWorkspaceDirHome(pickCurrentGlobalSettings(parsed.settings)),
    ...terminal.settings,
    ...profile.settings,
    defaultTuiAgent:
      parsed.settings?.defaultTuiAgent === 'blank' || isTuiAgent(parsed.settings?.defaultTuiAgent)
        ? parsed.settings.defaultTuiAgent
        : null,
    nativeChatAppearance: normalizeNativeChatAppearanceSettings(
      parsed.settings?.nativeChatAppearance
    ),
    nativeChatProviders: normalizeNativeChatProviders(parsed.settings?.nativeChatProviders),
    prBotAuthorOverrides: normalizePRBotAuthorOverrides(parsed.settings?.prBotAuthorOverrides),
    terminalCursorStyle: ['bar', 'block', 'underline'].includes(
      parsed.settings?.terminalCursorStyle
    )
      ? parsed.settings.terminalCursorStyle
      : defaults.settings.terminalCursorStyle,
    terminalTuiScrollSensitivity:
      typeof parsed.settings?.terminalTuiScrollSensitivity === 'number' &&
      Number.isFinite(parsed.settings.terminalTuiScrollSensitivity)
        ? parsed.settings.terminalTuiScrollSensitivity
        : defaults.settings.terminalTuiScrollSensitivity,
    compactWorktreeCards: profile.loadedCompactWorktreeCards,
    terminalShortcutPolicy: normalizeTerminalShortcutPolicy(
      parsed.settings?.terminalShortcutPolicy
    ),
    openInApplications: normalizeOpenInApplications(parsed.settings?.openInApplications, {
      seedDefaults: true
    }),
    terminalDefaultShell: normalizeTerminalDefaultShell(parsed.settings?.terminalDefaultShell),
    terminalQuickCommands: normalizeTerminalQuickCommands(parsed.settings?.terminalQuickCommands),
    terminalCustomThemes: normalizeTerminalCustomThemes(parsed.settings?.terminalCustomThemes),
    ...normalizePluginOwnedSettings(parsed.settings ?? {}),
    pluginSystemEnabled: pluginSystemEnabled !== false,
    nodeDistMirrorUrl: normalizeNodeDistMirrorUrl(parsed.settings?.nodeDistMirrorUrl).value,
    orchestrationHeartbeatIntervalMinutes: resolveOrchestrationHeartbeatInterval(
      parsed.settings ?? {}
    ),
    experimentalBrowserExtensions: parsed.settings?.experimentalBrowserExtensions !== false,
    experimentalConnectors: parsed.settings?.experimentalConnectors !== false,
    appIcon: normalizeAppIconId(parsed.settings?.appIcon),
    machineName: normalizeMachineName(parsed.settings?.machineName),
    // Why: persisted settings may be hand-edited or from older builds; keep tray-minimize false unless stored value is true.
    minimizeToTrayOnClose: parsed.settings?.minimizeToTrayOnClose === true,
    // Why: missing means default-on; round-trips unchanged on non-mac since darwin consumers gate the effect.
    showMenuBarIcon: parsed.settings?.showMenuBarIcon !== false,
    uiLanguage: normalizeUiLanguage(parsed.settings?.uiLanguage),
    // Why: the structured runtime reads these per launch; a malformed hand-edited value must not fail a chat.
    nativeChatInheritShellEnvironment: parsed.settings?.nativeChatInheritShellEnvironment !== false,
    nativeChatShellEnvironmentVariables: normalizeNativeChatShellEnvironmentVariables(
      parsed.settings?.nativeChatShellEnvironmentVariables
    ),

    voice: { ...getDefaultVoiceSettings(), ...parsed.settings?.voice },
    telemetry: normalizeCurrentTelemetry(parsed.settings?.telemetry)
  }
  return settings
}
