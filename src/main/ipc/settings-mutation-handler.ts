import { resolveAiVaultSearchSettings } from '../../shared/ai-vault-search-settings'
import { isAgentStatusHooksEnabledForAgent } from '../../shared/agent-status-hooks-setting'
import { applySessionSearchSettingsChange } from '../ai-vault-search/session-search-enablement'
import { app, ipcMain, nativeTheme } from 'electron'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { normalizeAppIconId } from '../../shared/app-icon'
import {
  normalizeComputerAwakeMode,
  computerAwakeSettingsForMode
} from '../../shared/computer-awake-mode'
import {
  normalizeMobilePairingCustomAddress,
  normalizeMobilePairingCustomAddresses
} from '../../shared/mobile-pairing-custom-address'
import { normalizeProxyBypassRules, normalizeProxyUrl } from '../../shared/network-proxy'
import { normalizeTerminalCustomThemes } from '../../shared/terminal-custom-themes'
import { normalizeTerminalLineHeight } from '../../shared/terminal-line-height-settings'
import { normalizeDesktopTerminalScrollbackRows } from '../../shared/terminal-scrollback-policy'
import { SETTINGS_CHANGED_WHITELIST, type SettingsChangedKey } from '../../shared/telemetry-events'
import { haveSameDisabledTuiAgents } from '../../shared/tui-agent-selection'
import { normalizeUiLanguage } from '../../shared/ui-language'
import { applyAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'
import type { AgentAwakeService } from '../agent-awake-service'
import { applyAppIcon } from '../app-icon'
import { browserSessionRegistry } from '../browser/browser-session-registry'
import { applyBrowserSessionProxies } from '../browser/browser-session-proxy'
import { setMainUiLanguage } from '../i18n/main-i18n'
import { rebuildAppMenu } from '../menu/register-app-menu'
import { applyElectronProxySettings } from '../network/proxy-settings'
import type { Store } from '../persistence'
import { track } from '../telemetry/client'
import { prepareLocalWorktreeRootsForRepos } from '../worktree-root-preparation'
import { recordManagedHookInstallFailure } from '../agent-hooks/install-telemetry'
import { sanitizeFloatingWorkspaceDirectorySetting } from './floating-workspace-directory'
import { scheduleCurrentWorktreeBaseDirectoryWatcherSync } from './worktree-base-directory-watcher'

type LegacyTerminalScrollbackSettingsUpdate = Partial<GlobalSettings> & {
  terminalScrollbackBytes?: unknown
}

const SETTINGS_CHANGED_WHITELIST_SET = new Set<string>(SETTINGS_CHANGED_WHITELIST)
const APPEARANCE_MENU_KEYS: readonly (keyof GlobalSettings)[] = [
  'showTasksButton',
  'showAutomationsButton',
  'showTitlebarAppName'
]

function sanitizeRendererSettingsUpdate(args: Partial<GlobalSettings>): Partial<GlobalSettings> {
  const { terminalScrollbackBytes: _legacyScrollbackBytes, ...sanitizedArgs } =
    args as LegacyTerminalScrollbackSettingsUpdate
  void _legacyScrollbackBytes
  delete sanitizedArgs.pluginConsents
  delete sanitizedArgs.disabledPlugins
  return sanitizedArgs
}

export function registerSettingsMutationHandler(
  store: Store,
  agentAwakeService?: AgentAwakeService
): void {
  ipcMain.handle('settings:set', async (event, args: Partial<GlobalSettings>) => {
    const sanitizedArgs = sanitizeRendererSettingsUpdate(args)
    delete sanitizedArgs.activeRuntimeEnvironmentId
    delete sanitizedArgs.floatingTerminalTrustedCwds
    if ('computerAwakeMode' in sanitizedArgs) {
      Object.assign(
        sanitizedArgs,
        computerAwakeSettingsForMode(
          normalizeComputerAwakeMode(
            sanitizedArgs.computerAwakeMode,
            sanitizedArgs.keepComputerAwakeWhileAgentsRun
          )
        )
      )
    } else if ('keepComputerAwakeWhileAgentsRun' in sanitizedArgs) {
      Object.assign(
        sanitizedArgs,
        computerAwakeSettingsForMode(sanitizedArgs.keepComputerAwakeWhileAgentsRun ? 'auto' : 'off')
      )
    }
    if (typeof args.floatingTerminalCwd === 'string') {
      sanitizedArgs.floatingTerminalCwd = await sanitizeFloatingWorkspaceDirectorySetting(
        store,
        args.floatingTerminalCwd
      )
    }
    if ('httpProxyUrl' in args) {
      const proxyUrl = normalizeProxyUrl(args.httpProxyUrl)
      sanitizedArgs.httpProxyUrl = proxyUrl.ok ? proxyUrl.value : ''
    }
    if ('httpProxyBypassRules' in args) {
      sanitizedArgs.httpProxyBypassRules = normalizeProxyBypassRules(args.httpProxyBypassRules)
    }
    if ('appIcon' in args) {
      sanitizedArgs.appIcon = normalizeAppIconId(args.appIcon)
    }
    if ('aiVaultSearch' in args) {
      sanitizedArgs.aiVaultSearch = resolveAiVaultSearchSettings(args)
    }
    if ('terminalCustomThemes' in args) {
      sanitizedArgs.terminalCustomThemes = normalizeTerminalCustomThemes(args.terminalCustomThemes)
    }
    if ('terminalScrollbackRows' in args) {
      sanitizedArgs.terminalScrollbackRows = normalizeDesktopTerminalScrollbackRows(
        args.terminalScrollbackRows
      )
    }
    if ('terminalLineHeight' in args) {
      sanitizedArgs.terminalLineHeight = normalizeTerminalLineHeight(args.terminalLineHeight)
    }
    if ('uiLanguage' in args) {
      sanitizedArgs.uiLanguage = normalizeUiLanguage(args.uiLanguage)
    }
    if ('mobilePairingCustomAddress' in args) {
      sanitizedArgs.mobilePairingCustomAddress = normalizeMobilePairingCustomAddress(
        args.mobilePairingCustomAddress
      )
    }
    if ('mobilePairingCustomAddresses' in args) {
      sanitizedArgs.mobilePairingCustomAddresses = normalizeMobilePairingCustomAddresses(
        args.mobilePairingCustomAddresses
      )
    }
    if (args.theme) {
      nativeTheme.themeSource = args.theme
    }

    const before = store.getSettings()
    const result = store.updateSettings(sanitizedArgs, {
      notifyListeners: true,
      originWebContentsId: event.sender.id
    })
    const proxySettingsChanged =
      ('httpProxyUrl' in sanitizedArgs && before.httpProxyUrl !== result.httpProxyUrl) ||
      ('httpProxyBypassRules' in sanitizedArgs &&
        before.httpProxyBypassRules !== result.httpProxyBypassRules)
    if (proxySettingsChanged) {
      const [defaultSessionResult, browserSessionsResult] = await Promise.allSettled([
        applyElectronProxySettings(result),
        applyBrowserSessionProxies(browserSessionRegistry.listProfiles(), result)
      ])
      if (defaultSessionResult.status === 'rejected') {
        console.warn('[settings] failed to apply network proxy settings')
      }
      if (browserSessionsResult.status === 'rejected') {
        console.warn('[settings] failed to apply network proxy settings to browser sessions')
      }
    }
    if (
      'computerAwakeMode' in sanitizedArgs ||
      'keepComputerAwakeWhileAgentsRun' in sanitizedArgs
    ) {
      agentAwakeService?.setMode(
        normalizeComputerAwakeMode(result.computerAwakeMode, result.keepComputerAwakeWhileAgentsRun)
      )
    }
    const hookSettingChanged =
      ('agentStatusHooksEnabled' in sanitizedArgs &&
        before.agentStatusHooksEnabled !== result.agentStatusHooksEnabled) ||
      ('disabledTuiAgents' in sanitizedArgs &&
        !haveSameDisabledTuiAgents(before.disabledTuiAgents, result.disabledTuiAgents))
    if (hookSettingChanged) {
      try {
        await applyAgentStatusHooksEnabled(result.agentStatusHooksEnabled, result, {
          userInitiated: true,
          shouldHydrateShellPath: app.isPackaged,
          onInstallError: recordManagedHookInstallFailure,
          shouldContinue: (agent) => isAgentStatusHooksEnabledForAgent(store.getSettings(), agent)
        })
      } catch (error) {
        console.warn('[settings] failed to reconcile managed agent hooks:', error)
      }
    }
    if ('uiLanguage' in sanitizedArgs && before.uiLanguage !== result.uiLanguage) {
      await setMainUiLanguage(result.uiLanguage)
      rebuildAppMenu()
    }
    if (
      ('workspaceDir' in sanitizedArgs && before.workspaceDir !== result.workspaceDir) ||
      ('nestWorkspaces' in sanitizedArgs && before.nestWorkspaces !== result.nestWorkspaces)
    ) {
      void prepareLocalWorktreeRootsForRepos(store)
      scheduleCurrentWorktreeBaseDirectoryWatcherSync()
    }
    if (APPEARANCE_MENU_KEYS.some((key) => key in sanitizedArgs)) {
      rebuildAppMenu()
    }
    if ('appIcon' in sanitizedArgs && before.appIcon !== result.appIcon) {
      applyAppIcon(result.appIcon)
    }

    if ('aiVaultSearch' in sanitizedArgs) {
      applySessionSearchSettingsChange(before, result)
    }
    for (const key of Object.keys(sanitizedArgs)) {
      if (!SETTINGS_CHANGED_WHITELIST_SET.has(key)) {
        continue
      }
      const beforeValue = (before as Record<string, unknown>)[key]
      const afterValue = (result as Record<string, unknown>)[key]
      if (beforeValue === afterValue || typeof afterValue !== 'boolean') {
        continue
      }
      track('settings_changed', { setting_key: key as SettingsChangedKey, value_kind: 'bool' })
    }
    return result
  })
}
