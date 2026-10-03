import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductUpdateSource } from './updater-test-harness'

const {
  autoUpdaterMock,
  powerMonitorOnMock,
  fetchNudgeMock,
  fetchNewerReleaseTagsMock,
  productUpdatePolicy,
  productUpdateSourceState,
  installProductUpdaterNetworkBoundaryMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('@electron-toolkit/utils', () => moduleFactories.electronToolkitUtils())
vi.mock('./ipc/pty', () => moduleFactories.ipcPty())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())
vi.mock('../shared/product-update-policy', () => moduleFactories.productUpdatePolicy())
vi.mock('../shared/product-update-source', () => moduleFactories.productUpdateSource())
vi.mock('./product/product-updater-network-boundary', () =>
  moduleFactories.productUpdaterNetworkBoundary()
)
vi.mock('./linux-root-package-install-policy', () =>
  moduleFactories.linuxRootPackageInstallPolicy()
)

function configuredProductSource(
  channel: ProductUpdateSource['channel'] = 'stable'
): ProductUpdateSource {
  return {
    channel,
    feedUrl: 'https://github.com/coder-lulu/hive-code/releases/latest/download',
    github: {
      repo: 'coder-lulu/hive-code',
      atomFeedUrl: 'https://github.com/coder-lulu/hive-code/releases.atom',
      releasesDownloadBase: 'https://github.com/coder-lulu/hive-code/releases/download',
      releasesApiUrl: 'https://api.github.com/repos/coder-lulu/hive-code/releases'
    },
    provider: 'github'
  }
}

describe('updater product boundary', () => {
  beforeEach(() => {
    resetUpdaterMocks()
  })

  it('loads a fresh updater after reset while isolating abandoned instances', () => {
    const loader = moduleFactories.electronUpdaterLoader()
    const abandonedUpdater = loader.loadElectronAutoUpdater()
    resetUpdaterMocks()
    const currentUpdater = loader.loadElectronAutoUpdater()
    const feed = { provider: 'generic', url: 'https://downloads.example.com/stable/' }

    abandonedUpdater.setFeedURL(feed)
    abandonedUpdater.allowPrerelease = true
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.allowPrerelease).toBe(false)

    currentUpdater.setFeedURL(feed)
    currentUpdater.allowPrerelease = true
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledExactlyOnceWith(feed)
    expect(autoUpdaterMock.allowPrerelease).toBe(true)
  })

  it('preserves third-party error text when publishing update status', async () => {
    productUpdateSourceState.value = configuredProductSource()
    const send = vi.fn()
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })
    const message = 'Server rejected artifact "Orca report.zip" in /work/Orca Project'
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      autoUpdaterMock.emit('error', new Error(message))
      return new Promise(() => {})
    })
    checkForUpdatesFromMenu()
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({ state: 'error', message })
      )
    })
  })

  it('configures the release feed from the product update source', async () => {
    productUpdateSourceState.value = configuredProductSource()
    const { setupAutoUpdater } = await import('./updater')

    setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })

    expect(autoUpdaterMock.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://github.com/coder-lulu/hive-code/releases/latest/download'
    })
    expect(autoUpdaterMock.disableDifferentialDownload).toBe(true)
  })

  it('installs the network boundary before configuring the product feed', async () => {
    productUpdateSourceState.value = configuredProductSource()
    const { setupAutoUpdater } = await import('./updater')

    setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })

    expect(installProductUpdaterNetworkBoundaryMock).toHaveBeenCalledWith(
      'coder-lulu/hive-code',
      expect.any(Function),
      autoUpdaterMock.httpExecutor,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    )
    expect(installProductUpdaterNetworkBoundaryMock.mock.invocationCallOrder[0]).toBeLessThan(
      autoUpdaterMock.setFeedURL.mock.invocationCallOrder[0]
    )
  })

  it('does not launch a pinned check without an approved tag download base', async () => {
    productUpdateSourceState.value = {
      channel: 'stable',
      feedUrl: 'https://downloads.example.com/product-update/stable/',
      github: null,
      provider: 'github'
    }
    fetchNewerReleaseTagsMock.mockResolvedValue(['v1.0.52'])
    const { checkForUpdatesFromMenu, setupAutoUpdater } = await import('./updater')
    setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })
    autoUpdaterMock.setFeedURL.mockClear()

    checkForUpdatesFromMenu()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(installProductUpdaterNetworkBoundaryMock).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      autoUpdaterMock.httpExecutor,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    )
    expect(fetchNewerReleaseTagsMock).not.toHaveBeenCalled()
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('keeps local-only initialization isolated from release services', async () => {
    const send = vi.fn()
    const { getRemoteServerUpdateSupport, setupAutoUpdater, checkForRemoteServerUpdate } =
      await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never, {
      getLastUpdateCheckAt: () => null,
      localOnly: true
    })

    expect(checkForRemoteServerUpdate('runtime-1').status).toEqual({
      state: 'disabled',
      reason: 'not-configured'
    })
    expect(getRemoteServerUpdateSupport()).toEqual({
      installMode: 'interactive',
      automatic: false,
      reason: 'updater-unavailable'
    })
    expect(installProductUpdaterNetworkBoundaryMock).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      autoUpdaterMock.httpExecutor,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    )
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(fetchNewerReleaseTagsMock).not.toHaveBeenCalled()
    expect(fetchNudgeMock).not.toHaveBeenCalled()
    expect(powerMonitorOnMock).not.toHaveBeenCalled()
  })

  it('denies online entrypoints when product update authority is absent', async () => {
    productUpdatePolicy.configured = false
    productUpdateSourceState.value = null
    const send = vi.fn()
    const {
      checkForUpdates,
      checkForUpdatesFromMenu,
      listAvailableReleaseBuilds,
      setupAutoUpdater
    } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })

    checkForUpdates()
    checkForUpdatesFromMenu()
    checkForUpdatesFromMenu()
    await expect(listAvailableReleaseBuilds('stable')).resolves.toEqual([])

    expect(installProductUpdaterNetworkBoundaryMock).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      autoUpdaterMock.httpExecutor,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    )
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(fetchNewerReleaseTagsMock).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('updater:status', {
      state: 'disabled',
      reason: 'not-configured'
    })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
