import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ProfilePreferences } from '../persistence/loading-store/profile-preferences'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { RuntimeMobileNotificationController } from '../runtime/runtime-mobile-notification-controller'
import { acquireProfileStateMaintenance } from '../persistence/profile-state/profile-state-access'
import { profileStateAccessPaths } from '../persistence/profile-state/profile-state-access-owner'

const state = vi.hoisted(() => ({
  root: '',
  controller: null as RuntimeMobileNotificationController | null,
  rpcStarted: false,
  notificationCount: 0,
  cloudReady: vi.fn(),
  cloudStop: vi.fn(async () => {}),
  profileStartupErrors: new Array<Error>(),
  onSettingsChanged: vi.fn<ProfilePreferences['onSettingsChanged']>(),
  removeSettingsListener: vi.fn(),
  startDaemon: vi.fn(async () => {}),
  browserProvider: vi.fn(async () => null),
  startCodexHooks: vi.fn(),
  installManagedAgentHooks: vi.fn(async () => []),
  refreshOpenCodePlugins: vi.fn(),
  adoptLoginShellAgentHomes: vi.fn(async () => {})
}))
const profile = vi.hoisted(() => {
  const value: { settings: Partial<GlobalSettings> } = { settings: {} }
  return value
})
// Why: startup reconciles the user-global agent configs; keep it off this machine's real home.
vi.mock('../codex/codex-hook-reconcile', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startCodexHooks: state.startCodexHooks
}))
vi.mock('../agent-hooks/managed-agent-hook-controls', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installManagedAgentHooks: state.installManagedAgentHooks
}))
vi.mock('../agent-hooks/local-agent-cli-presence', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hydrateAgentCliShellPath: async () => {}
}))
vi.mock('../agent-hooks/agent-home-login-shell', () => ({
  adoptLoginShellAgentHomes: state.adoptLoginShellAgentHomes
}))
vi.mock('../opencode/opencode-status-plugin-startup-refresh', () => ({
  refreshInstalledOpenCodeStatusPlugins: state.refreshOpenCodePlugins
}))
vi.mock('./orcad-app-paths', () => ({
  resolveOrcadInstallRoot: () => state.root,
  resolveOrcadPath: () => state.root,
  resolveUserDataPath: () => state.root
}))
vi.mock('./orcad-browser-provider', () => ({ resolveOrcadBrowserProvider: state.browserProvider }))
vi.mock('./orcad-instance-lock', () => ({
  acquireOrcadInstanceLock: () => ({
    path: join(state.root, 'orcad.lock'),
    record: { pid: process.pid, startedAtMs: null, nonce: 'headless-instance' },
    release() {}
  })
}))
vi.mock('./orcad-daemon-supervision', () => ({
  startOrcadDaemon: state.startDaemon,
  stopOrcadDaemon: async () => {}
}))
vi.mock('./orcad-health', () => ({ collectOrcadHealth: async () => ({}) }))
// The runtime stub has no automation surface; orcad-automations.test.ts covers that wiring.
vi.mock('./orcad-automations', () => ({
  startOrcadAutomations: () => {},
  stopOrcadAutomationScheduler: () => {},
  orcadAutomationsKeepHostBusy: () => false
}))
// Why: the real updater would fetch rules from GitHub inside a unit test.
vi.mock('../runtime/agent-state-rules/agent-state-rules-live-update', () => ({
  startAgentStateRulesLiveUpdates: () => {}
}))
vi.mock('../daemon/daemon-provider-state', () => ({ daemonOwnsFreshPersistentPtys: () => false }))
vi.mock('../ipc/pty/register-headless-runtime', () => ({
  registerHeadlessPtyRuntime: async () => {}
}))
vi.mock('../ipc/pty/provider/registry', () => ({ getLocalPtyProvider: () => null }))
vi.mock('./orcad-profile-state-startup', () => ({
  createOrcadProfileStateStartup: async () => {
    const error = state.profileStartupErrors.shift()
    if (error) {
      throw error
    }
    return {
      store: {
        getSettings: () => profile.settings,
        onSettingsChanged: state.onSettingsChanged,
        flushFinalOrThrowAsync: async () => {},
        freezeWritesAsync: async () => {}
      },
      authority: {
        backend: 'sqlite',
        classification: 'neither',
        authority_mode: 'sqlite-candidate',
        runtime: 'orcad',
        migrated: false
      }
    }
  }
}))
vi.mock('../orca-profiles/profile-index-store', () => ({
  initOrcaProfilePaths() {},
  ensureActiveOrcaProfile: () => ({
    dataFile: join(state.root, 'profile.json'),
    stateDatabaseFile: join(state.root, 'profile-state.db'),
    profile: { id: 'headless-profile' }
  })
}))
vi.mock('../ssh/ssh-host-key-store', () => ({ initSshHostKeyStoreFile() {} }))
vi.mock('../server/serve-readiness', () => ({
  ServeReadinessPublisher: class {
    async publish() {}
  }
}))
vi.mock('../runtime/orca-runtime', () => ({
  OrcaRuntimeService: class {
    getRuntimeId() {
      return 'headless-runtime'
    }
    rehydrateClientHostedBrowserPages() {}
    restoreHostAccountLaunchEnv() {}
    async refreshRestoredOrchestrationAuthority() {}
    async reconcileLegacyWorkerTerminals() {}
    async installPendingOrcadMigrationShellHistory() {}
    async stopLegacyWorkerTerminalRecovery() {}
    async closeNotificationDismissals() {}
    syncWindowGraph() {}
    onNotificationDispatched(
      listener: Parameters<RuntimeMobileNotificationController['onDispatched']>[0]
    ) {
      return state.controller!.onDispatched(listener)
    }
  }
}))
vi.mock('../runtime/runtime-rpc', () => ({
  OrcaRuntimeRpcServer: class {
    private removeNotificationListener = () => {}
    constructor(
      private readonly options: {
        runtime: {
          onNotificationDispatched: RuntimeMobileNotificationController['onDispatched']
        }
      }
    ) {}
    async start() {
      state.rpcStarted = true
      this.removeNotificationListener = this.options.runtime.onNotificationDispatched(() => {
        state.notificationCount++
      })
    }
    async stop() {
      this.removeNotificationListener()
      state.rpcStarted = false
    }
    getWebSocketEndpoint() {
      return null
    }
  }
}))
vi.mock('./orcad-runtime-cloud', () => ({
  createOrcadRuntimeCloud: () => ({
    ownership: {},
    getPresenceState: () => 'SIGNED_OUT',
    rpcReady() {
      expect(state.rpcStarted).toBe(true)
      state.cloudReady()
    },
    stop: state.cloudStop
  })
}))

beforeEach(() => {
  state.onSettingsChanged.mockReturnValue(state.removeSettingsListener)
  state.notificationCount = 0
})

afterEach(() => {
  rmSync(state.root, { recursive: true, force: true })
  state.profileStartupErrors.length = 0
  profile.settings = {}
  vi.clearAllMocks()
})

it('refuses recovery overlap before initializing the browser provider or runtime', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'orca-headless-recovery-'))
  const maintenance = acquireProfileStateMaintenance(state.root)
  const { startOrcad, parseArgs } = await import('./orcad-entry')
  const commandArguments = await import('./orcad-command-arguments')
  try {
    expect(parseArgs).toBe(commandArguments.parseArgs)
    await expect(startOrcad({ noPairing: true, json: true })).rejects.toThrow()
    expect(state.browserProvider).not.toHaveBeenCalled()
    expect(state.rpcStarted).toBe(false)
  } finally {
    maintenance.release()
  }
})

it('starts owned cloud access after RPC and reports Hive push unavailable without an account', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'orca-headless-push-'))
  state.controller = new RuntimeMobileNotificationController()
  const { startOrcad } = await import('./orcad-entry')
  const host = await startOrcad({ noPairing: true, json: true })
  try {
    expect(state.cloudReady).toHaveBeenCalledOnce()
    expect(state.controller.getListenerCount()).toBe(1)
    await expect(state.controller.testRemotePush()).resolves.toEqual({
      accepted: false,
      reason: 'unavailable'
    })
    state.controller.dispatch({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'QA',
      body: 'QA'
    })
    expect(state.notificationCount).toBe(1)
  } finally {
    await host.stop()
  }
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
  acquireProfileStateMaintenance(state.root).release()
  expect(state.controller.getListenerCount()).toBe(0)
  expect(state.rpcStarted).toBe(false)
  expect(state.cloudStop).toHaveBeenCalledOnce()
  expect(state.onSettingsChanged).toHaveBeenCalledOnce()
  expect(state.removeSettingsListener).toHaveBeenCalledOnce()
  await host.stop()
  expect(state.removeSettingsListener).toHaveBeenCalledOnce()
  state.controller.dispatch({ type: 'notification', source: 'test', title: 'QA', body: 'QA' })
  expect(state.notificationCount).toBe(1)
  await expect(state.controller.testRemotePush()).resolves.toEqual({
    accepted: false,
    reason: 'unavailable'
  })
})

it('releases admission when host setup fails before a runtime exists', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'orca-headless-setup-failure-'))
  state.profileStartupErrors.push(new Error('profile startup failed'))
  const { startOrcad } = await import('./orcad-entry')
  await expect(startOrcad()).rejects.toThrow('profile startup failed')
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
  acquireProfileStateMaintenance(state.root).release()
})

it('serves RPC without waiting for browser discovery', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'orca-headless-browser-pending-'))
  let finishDiscovery!: () => void
  state.browserProvider.mockReturnValueOnce(
    new Promise<null>((resolve) => {
      finishDiscovery = () => resolve(null)
    })
  )
  const { startOrcad } = await import('./orcad-entry')
  const host = await startOrcad({ noPairing: true, json: true })
  expect(host.managedStop).toMatchObject({
    runtimeId: 'headless-runtime',
    instance: { pid: process.pid, nonce: 'headless-instance' }
  })
  finishDiscovery()
  await host.stop()
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
})

it('unsubscribes settings when daemon startup fails after hook setup', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'orca-headless-daemon-failure-'))
  state.startDaemon.mockRejectedValueOnce(new Error('daemon setup failed'))
  const { startOrcad } = await import('./orcad-entry')
  await expect(startOrcad()).rejects.toThrow('daemon setup failed')
  expect(state.onSettingsChanged).toHaveBeenCalledOnce()
  expect(state.removeSettingsListener).toHaveBeenCalledOnce()
  expect(readdirSync(profileStateAccessPaths(state.root).participants)).toEqual([])
  acquireProfileStateMaintenance(state.root).release()
})

// Why: a freshly managed SSH host starts orcad on connect; without this its agents never report status.
it('installs agent status hooks on the host when it starts', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'orca-headless-hooks-'))
  const { startOrcad } = await import('./orcad-entry')
  const host = await startOrcad({ noPairing: true, json: true })
  try {
    expect(state.startCodexHooks).toHaveBeenCalledOnce()
    // orcad launches Codex on the real ~/.codex; it has no Orca-managed account homes.
    expect(state.startCodexHooks.mock.calls[0]![0].resolveLaunchHome()).toBeNull()
    await vi.waitFor(() =>
      expect(state.installManagedAgentHooks).toHaveBeenCalledWith(
        profile.settings,
        expect.objectContaining({ shouldHydrateShellPath: true })
      )
    )
    expect(state.refreshOpenCodePlugins).toHaveBeenCalledWith(profile.settings)
    // Grok/Kiro homes set only in login profiles must be known before their installers run.
    expect(state.adoptLoginShellAgentHomes.mock.invocationCallOrder[0]).toBeLessThan(
      state.installManagedAgentHooks.mock.invocationCallOrder[0]!
    )
  } finally {
    await host.stop()
  }
})

it('leaves agent configs alone when status hooks are off', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'orca-headless-hooks-off-'))
  profile.settings = { agentStatusHooksEnabled: false }
  const { startOrcad } = await import('./orcad-entry')
  const host = await startOrcad({ noPairing: true, json: true })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    expect(state.installManagedAgentHooks).not.toHaveBeenCalled()
    expect(state.startCodexHooks.mock.calls[0]![0].isEnabled()).toBe(false)
  } finally {
    await host.stop()
  }
})
