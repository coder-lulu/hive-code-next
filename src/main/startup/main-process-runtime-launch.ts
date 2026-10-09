import { installRuntimeRpc } from './main-process-runtime-rpc'
import { app, type BrowserWindow } from 'electron'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import {
  completePendingUserDataMigration,
  showUserDataMigrationWarning
} from './main-process-user-data-migration'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { getLocalPtyProvider, registerHeadlessPtyRuntime } from '../ipc/pty'
import { LocalPtyProvider } from '../providers/local-pty-provider'
import { publishHeadlessRuntimeGraph } from '../runtime/headless-runtime-graph'
import { OffscreenBrowserBackend } from '../browser/offscreen-browser-backend'
import { browserManager } from '../browser/browser-manager'
import { getServeOptions, printServeReady } from './main-process-serve'
import {
  bindTerminalRuntimeStartupServices,
  handleCodexHomePtySpawned,
  handlePtyExit,
  startTerminalRuntimeStartupServices
} from './main-process-pty-startup'
import { prepareCodexRuntimeHomeForLaunch } from './codex-launch-preparation'
import { prepareCodexSessionResumeForLaunch } from './codex-session-resume-launch'
import { startWindowsDesktopBeforeShellPathReady } from './windows-desktop-shell-path-startup'
import { repairKnownPoisonedInstallDirBeforeWindow } from './windows-install-dir-acl-recovery'
import { registerServeSignalHandlers } from './serve-signal-handlers'
import { settleServeDesktopActivation } from './serve-desktop-activation'
import {
  recordRuntimeRpcStartFailure,
  showRuntimeRpcStartupFailureDialog
} from '../runtime/runtime-rpc-startup-failure'
import { CliInstaller } from '../cli/cli-installer'
import { installLinuxBareOrcaDispatcher } from '../cli/linux-bare-orca-dispatcher'
import { scheduleAllPendingHistoryTreeRemovals } from '../terminal-history-deletion'
import { triggerStartupNotificationRegistration } from '../ipc/startup-notification-registration'
import { mainProcessState as state } from './main-process-state'
import { logStartupMilestone } from './startup-diagnostics'
import { scheduleAgentLaunchRecordWarmup } from './agent-launch-record-warmup'
import { emitServeBrowserIdentityActionLine } from '../server/serve-stdout-boundary'
import { getBrowserIdentityModeStatus } from '../browser/browser-identity-mode-store'

type RuntimeService = NonNullable<typeof state.runtime>

export type MainProcessRuntimeLaunchOptions = {
  openMainWindow: (options?: { revealOnDidFinishLoad?: boolean }) => BrowserWindow
  handleMacAppActivation: () => void
}

function settleDesktopActivation(): void {
  const gate = state.desktopActivationGate
  if (!gate) {
    return
  }
  settleServeDesktopActivation(gate, {
    hasPersistentPtyProvider: !(getLocalPtyProvider() instanceof LocalPtyProvider)
  })
}

async function launchServeMode(
  runtime: RuntimeService,
  runtimeRpc: OrcaRuntimeRpcServer,
  serveOptions: NonNullable<ReturnType<typeof getServeOptions>>
): Promise<void> {
  // Why here: headless serve has no window to unblock, so keep the persisted proxy strictly
  // ahead of every fetcher this phase can reach (relay, CLI install, RPC clients).
  await state.initialProxyApplicationReady
  // Why: give managed WSL launchers a brief chance to migrate before headless PTYs go live, without slow repairs withholding all RPC readiness.
  logStartupMilestone('wsl-cli-barrier-start')
  await state.managedWslCliStartupBarrierReady
  logStartupMilestone('wsl-cli-barrier-resolved', {
    reconciliation: state.managedWslCliReconciliationStatus
  })
  // Why: headless PTYs must not start on the fallback provider, then get swept when an activated renderer registers desktop lifecycle handlers.
  await state.localPtyStartupReady
  await state.localPtyProviderStartupReady
  await registerHeadlessPtyRuntime(
    runtime,
    prepareCodexRuntimeHomeForLaunch,
    () => state.store!.getSettings(),
    (target) => state.claudeRuntimeAuth!.prepareForClaudeLaunch(target),
    state.store!,
    prepareCodexSessionResumeForLaunch,
    { onCodexHomePtySpawned: handleCodexHomePtySpawned, onPtyExit: handlePtyExit }
  )
  await runtime.refreshRestoredOrchestrationAuthority()
  await runtime.reconcileLegacyWorkerTerminals()
  // Why: headless servers can't mount <webview> panes; use offscreen WebContents, gated on a real display so browser.headless.v1 stays honest.
  if (state.headlessBrowserDisplayAvailable) {
    runtime.setOffscreenBrowserBackend(
      new OffscreenBrowserBackend(browserManager, {
        getAgentBrowserBridge: () => state.agentBrowserBridge
      })
    )
  }
  publishHeadlessRuntimeGraph(runtime)
  await runtimeRpc.start().catch((error) => {
    console.error('[runtime] Failed to start headless RPC transport:', error)
    throw error
  })
  state.runtimeCloudPresence?.setRuntimeReady(true)
  scheduleAgentLaunchRecordWarmup(null)
  settleDesktopActivation()
  // Why: every attempt must reach app.quit(); a page beforeunload can veto an earlier signal.
  registerServeSignalHandlers(process, () => app.quit())
  // Why: headless serve has no renderer to run the normal cli:install flow; do it here for macOS/Linux only (Windows-excluded: install() only mutates registry PATH, not child terminals).
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try {
      // Why: serve is headless — a fallback osascript admin prompt would hang it; skip elevation since ~/.local/bin needs none.
      const cliStatus = await new CliInstaller({
        privilegedRunner: async () => {
          throw new Error('serve CLI auto-install must not request administrator privileges')
        }
      }).install()
      console.log(
        `[serve] ${APP_DISPLAY_NAME} CLI install: ${cliStatus.state}${cliStatus.commandPath ? ` (${cliStatus.commandPath})` : ''}`
      )
    } catch (error) {
      console.warn(
        `[serve] ${APP_DISPLAY_NAME} CLI install skipped:`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  // Why: Linux CLI installs as `orca-ide`, but the Claude Team launcher invokes bare `orca`; drop a ~/.local/bin dispatcher (ahead of /usr/bin) so it resolves. Best-effort.
  if (process.platform === 'linux' && app.isPackaged && process.resourcesPath) {
    try {
      const dispatcher = await installLinuxBareOrcaDispatcher({
        resourcesPath: process.resourcesPath
      })
      console.log(
        `[serve] legacy CLI dispatcher ${dispatcher.state}: ${dispatcher.dispatcherPath}` +
          `${dispatcher.target ? ` -> ${dispatcher.target}` : ''}`
      )
    } catch (error) {
      console.warn(
        '[serve] legacy CLI dispatcher install skipped:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  // Why: headless serve never opens a renderer, so arm scheduled automation dispatch here.
  state.automations?.start()
  // Why: serve deletes worktrees too, and the history GC that normally drains delete tombstones is
  // armed from the main window — without this, a quit mid-removal leaks the tree until a desktop launch.
  void scheduleAllPendingHistoryTreeRemovals()
  emitServeBrowserIdentityActionLine(getBrowserIdentityModeStatus())
  await printServeReady(serveOptions)
  completePendingUserDataMigration()
}

async function launchDesktopMode(
  runtimeRpc: OrcaRuntimeRpcServer,
  shellPathReady: Promise<void>,
  desktopWindow: BrowserWindow | null,
  openMainWindow: MainProcessRuntimeLaunchOptions['openMainWindow']
): Promise<void> {
  // Preserve the pre-split startup failure contract if composition ever hands
  // this phase an incomplete runtime graph.
  if (!runtimeRpc) {
    throw new Error('runtime_rpc_unavailable')
  }
  // Why: window and RPC startup run in parallel; registerPtyHandlers gates PTY spawns so RPC binds without racing the daemon provider swap.
  const [win, runtimeRpcStartResult] = await Promise.all([
    Promise.resolve(desktopWindow ?? openMainWindow()),
    shellPathReady
      .then(() => runtimeRpc.start())
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => {
          recordRuntimeRpcStartFailure(error)
          return { ok: false as const, error }
        }
      )
  ])
  scheduleAgentLaunchRecordWarmup(win)
  if (!runtimeRpcStartResult.ok) {
    // Why gated: this dialog is the only launch-phase text read through translateMain, and i18n
    // now settles alongside this phase — without the wait a non-English user could get the
    // English defaultValue fallback. Still off the renderer's path (it is failure-only).
    void state.mainProcessI18nReady.then(() =>
      showRuntimeRpcStartupFailureDialog(win, runtimeRpcStartResult.error)
    )
  }
  if (runtimeRpcStartResult.ok) {
    state.runtimeCloudPresence?.setRuntimeReady(true)
  }
  showUserDataMigrationWarning(win)
  await state.initialProxyApplicationReady
  // Why: macOS notification permission dialog must fire after the window is shown, else it's hidden behind the maximized window.
  win.once('show', () => {
    // Why: store can be null if init failed earlier; bail rather than throw inside an Electron event listener.
    const store = state.store
    if (store && store.getOnboarding().closedAt !== null) {
      triggerStartupNotificationRegistration(store)
    }
  })
}

export async function initializeMainProcessRuntimeLaunch(
  options: MainProcessRuntimeLaunchOptions
): Promise<void> {
  const runtime = state.runtime
  const shellPathHydration = state.windowsShellPathHydration
  if (!runtime || !shellPathHydration) {
    throw new Error('Runtime and shell-path services must be initialized before launch')
  }
  let serveOptions: ReturnType<typeof getServeOptions> | null = null
  try {
    serveOptions = state.isServeMode ? getServeOptions(process.argv) : null
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    app.exit(1)
    return
  }
  state.serveOptions = serveOptions
  const runtimeRpc = installRuntimeRpc(runtime, serveOptions)
  const shellPathReady = shellPathHydration.whenReady()
  // Why published: the renderer's git-environment barrier must fence on the same
  // generation the terminal startup services wait for, not a later re-read.
  state.shellPathReady = shellPathReady
  // Why before any window: the poisoned install DACL kills the renderer at init, and
  // the probe that detects it cannot finish before createMainWindow. Bounded, and a
  // no-op (one absent-file read) unless a previous launch already recorded the verdict.
  const aclGate = await repairKnownPoisonedInstallDirBeforeWindow({
    isServeMode: state.isServeMode || serveOptions !== null,
    userDataPath: app.getPath('userData'),
    appVersion: app.getVersion()
  })
  if (aclGate !== 'not-marked' && aclGate !== 'skipped') {
    logStartupMilestone('install-dir-acl-repair-blocking-done', { mode: aclGate })
  }
  let desktopWindow: BrowserWindow | null = null
  if (process.platform === 'win32' && app.isPackaged && !serveOptions) {
    const desktopStartup = startWindowsDesktopBeforeShellPathReady({
      bindServices: bindTerminalRuntimeStartupServices,
      openWindow: () => options.openMainWindow({ revealOnDidFinishLoad: true }),
      shellPathReady,
      startServices: startTerminalRuntimeStartupServices
    })
    desktopWindow = desktopStartup.window
  } else {
    await shellPathReady
    bindTerminalRuntimeStartupServices(Promise.resolve(startTerminalRuntimeStartupServices()))
  }
  app.on('activate', options.handleMacAppActivation)
  if (serveOptions) {
    await launchServeMode(runtime, runtimeRpc, serveOptions)
    return
  }
  await launchDesktopMode(runtimeRpc, shellPathReady, desktopWindow, options.openMainWindow)
  completePendingUserDataMigration()
}
