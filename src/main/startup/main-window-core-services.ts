import type { BrowserWindow } from 'electron'
import { registerCoreHandlers } from '../ipc/register-core-handlers/register-core-handlers'
import { attachMainWindowServices } from '../window/attach-main-window-services'
import { initTccPromptNotice } from '../macos-tcc-prompt-notice'
import { resolveUpdateInstallMode } from '../updater'
import { desktopConnectorCloud } from './main-process-connector-startup'
import { mainProcessState as state } from './main-process-state'
import { prepareCodexAiVaultSessionResume } from '../codex/codex-ai-vault-session-resume'
import { resolveHostCodexSessionSourceHome } from '../codex/codex-session-source-home'
import { preserveAgentAuthBeforeRestart } from '../agent-auth-restart-preservation'
import { preserveStateBeforeUpdateRestart } from '../update-restart-preservation'
import {
  emitPluginWorktreeLifecycle,
  handleCodexHomePtySpawned,
  handlePtyExit
} from './main-process-pty-startup'
import { prepareCodexRuntimeHomeForLaunch } from './codex-launch-preparation'
import { resolveHostAgentBaseEnvironment } from '../runtime/structured-agent-shell-environment'
import {
  prepareCodexPinnedLaunchHome,
  prepareCodexSessionResumeForLaunch
} from './codex-session-resume-launch'
import { isRecoveryReloadInFlight } from './main-window-lifecycle-flags'
import { holdLaunchReconnectOptOuts } from '../ipc/ssh/ssh-host-user-disconnect'

export function attachMainWindowCoreServices(
  window: BrowserWindow,
  deps: {
    markExpectedRendererReload: (webContentsId: number) => void
    recordRendererReload: (ignoreCache: boolean) => void
  }
): void {
  const store = state.store
  const runtime = state.runtime
  const stats = state.stats
  const claudeUsage = state.claudeUsage
  const codexUsage = state.codexUsage
  const openCodeUsage = state.openCodeUsage
  const museUsage = state.museUsage
  const codexAccounts = state.codexAccounts
  const claudeAccounts = state.claudeAccounts
  const rateLimits = state.rateLimits
  const automations = state.automations
  const keybindings = state.keybindings
  const codexRuntimeHome = state.codexRuntimeHome
  const claudeRuntimeAuth = state.claudeRuntimeAuth
  if (
    !store ||
    !runtime ||
    !stats ||
    !claudeUsage ||
    !codexUsage ||
    !openCodeUsage ||
    !museUsage ||
    !codexAccounts ||
    !claudeAccounts ||
    !rateLimits ||
    !automations ||
    !keybindings ||
    !codexRuntimeHome ||
    !claudeRuntimeAuth
  ) {
    throw new Error('Main window services must be initialized before attaching')
  }
  // Server status probes start inside registerCoreHandlers; held hosts must be marked first.
  holdLaunchReconnectOptOuts(store.getSshTargets())
  registerCoreHandlers(
    store,
    runtime,
    stats,
    claudeUsage,
    codexUsage,
    openCodeUsage,
    museUsage,
    codexAccounts,
    claudeAccounts,
    rateLimits,
    window.webContents.id,
    automations,
    {
      prepareForCodexLaunch: prepareCodexRuntimeHomeForLaunch,
      prepareForClaudeLaunch: (target) => claudeRuntimeAuth.prepareForClaudeLaunch(target),
      resolveBaseEnvironment: () => resolveHostAgentBaseEnvironment(store.getSettings())
    },
    state.agentAwakeService ?? undefined,
    state.crashReports ?? undefined,
    keybindings,
    {
      ...(state.hiveAccountService ? { hiveAccountService: state.hiveAccountService } : {}),
      ...(state.hiveAccountStartupState
        ? { hiveAccountStartupState: state.hiveAccountStartupState }
        : {}),
      ...(state.runtimeCloudDirectory && state.runtimeCloudSessions && state.localRuntimeOwnership
        ? {
            hiveRuntimeCloudServices: {
              directory: state.runtimeCloudDirectory,
              ownership: state.localRuntimeOwnership,
              sessions: state.runtimeCloudSessions
            }
          }
        : {}),
      getAdditionalAiVaultCodexHomePaths: () =>
        codexRuntimeHome.getHostCodexHomePathsForSessionDiscovery(),
      prepareAiVaultSessionResume: (args) =>
        prepareCodexAiVaultSessionResume(args, {
          runtimeHome: codexRuntimeHome,
          systemCodexHomePath: resolveHostCodexSessionSourceHome(store.getSettings()),
          preparePinnedLaunchHome: (home) => prepareCodexPinnedLaunchHome(home)
        }),
      onBeforeRelaunch: async () => {
        state.isQuitting = true
        state.runtimeCloudPresence?.setRuntimeReady(false)
        state.runtimeCloudPresence?.setAuthorization(null)
        desktopConnectorCloud()?.fence()
        await preserveAgentAuthBeforeRestart({ codexRuntimeHome, store })
      },
      onOrcaProfileAuthMutation: () => {
        desktopConnectorCloud()?.accountChanged()
      },
      onBeforeOrcaProfileSignOut: () => {
        desktopConnectorCloud()?.signOutStarted()
      },
      onAfterOrcaProfileSignOut: () => desktopConnectorCloud()?.signOutFinished()
    },
    state.pluginService ?? undefined,
    state.pluginMarketplaceService && state.pluginMarketplaceInstaller
      ? {
          marketplace: state.pluginMarketplaceService,
          installer: state.pluginMarketplaceInstaller,
          ...(state.pluginAutoUpdater ? { autoUpdater: state.pluginAutoUpdater } : {})
        }
      : undefined
  )
  automations.setWebContents(window.webContents)
  automations.start()
  attachMainWindowServices(
    window,
    store,
    runtime,
    prepareCodexRuntimeHomeForLaunch,
    (target) => claudeRuntimeAuth.prepareForClaudeLaunch(target),
    {
      prepareCodexSessionResume: prepareCodexSessionResumeForLaunch,
      awaitLocalPtyStartup: () => state.localPtyStartupReady,
      awaitLocalPtyProviderStartup: () => state.localPtyProviderStartupReady,
      onBeforeRendererReload: ({ ignoreCache, webContentsId }) => {
        if (window.webContents.id === webContentsId) {
          deps.markExpectedRendererReload(webContentsId)
        }
        deps.recordRendererReload(ignoreCache)
      },
      // Recovery did-finish-load must skip orphan sweeping to preserve live PTYs (#5787).
      isRecoveryReloadInFlight,
      onCodexHomePtySpawned: handleCodexHomePtySpawned,
      onPtyExit: handlePtyExit,
      onBeforeUpdateQuit: async () => {
        state.runtimeCloudPresence?.setRuntimeReady(false)
        state.runtimeCloudPresence?.setAuthorization(null)
        await preserveStateBeforeUpdateRestart({ codexRuntimeHome, store })
      },
      onBeforeUpdateQuitFailure: 'abort',
      updateInstallMode: resolveUpdateInstallMode(state.isServeMode),
      onWorktreeLifecycle: emitPluginWorktreeLifecycle
    }
  )
  // Attach durable diagnostic pulls now, defer process launch past first paint.
  initTccPromptNotice(window, { deferWatchUntilReadyToShow: true })
  rateLimits.attach(window)
  // Quota probes spawn CLIs/use network; defer to show/focus refresh so they do not compete with first paint.
  rateLimits.start({ fetchImmediately: false })
}
