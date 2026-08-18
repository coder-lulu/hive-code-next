import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductUpdateSource } from './updater-test-harness'

const {
  appMock,
  autoUpdaterMock,
  fetchNewerReleaseTagsMock,
  productUpdateSourceState,
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

function configuredProductSource(channel: 'stable' | 'rc'): ProductUpdateSource {
  return {
    channel,
    feedUrl: 'https://github.com/coder-lulu/hive-code/releases/latest/download',
    github: {
      repo: 'coder-lulu/hive-code',
      atomFeedUrl: 'https://github.com/coder-lulu/hive-code/releases.atom',
      releasesDownloadBase: 'https://github.com/coder-lulu/hive-code/releases/download',
      releasesApiUrl: 'https://api.github.com/repos/coder-lulu/hive-code/releases'
    }
  }
}

describe('updater product feed policy', () => {
  beforeEach(() => {
    resetUpdaterMocks()
  })

  it('uses the configured RC channel for an unmodified check', async () => {
    productUpdateSourceState.value = configuredProductSource('rc')
    fetchNewerReleaseTagsMock.mockResolvedValue(['v1.0.52-rc.1'])
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')
    setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })

    checkForUpdatesFromMenu()

    await vi.waitFor(() => {
      expect(fetchNewerReleaseTagsMock).toHaveBeenCalledWith('1.0.51', 2, {
        includePrerelease: true
      })
    })
    expect(autoUpdaterMock.allowPrerelease).toBe(true)
  })

  it('resets prerelease acceptance when an RC override changes to stable', async () => {
    let channel: 'stable' | 'rc' = 'rc'
    fetchNewerReleaseTagsMock
      .mockResolvedValueOnce(['v1.0.52-rc.1'])
      .mockResolvedValueOnce({ tags: [], state: 'no-newer' })
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => autoUpdaterMock.emit('update-not-available'))
      return Promise.resolve(undefined)
    })
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')
    setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now(),
      getReleaseChannelOverride: () => channel
    })

    checkForUpdatesFromMenu()
    await vi.waitFor(() => expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1))
    channel = 'stable'
    checkForUpdatesFromMenu()
    await vi.waitFor(() => expect(fetchNewerReleaseTagsMock).toHaveBeenCalledTimes(2))

    expect(fetchNewerReleaseTagsMock).toHaveBeenLastCalledWith('1.0.51', 1, {
      includePrerelease: false
    })
    expect(autoUpdaterMock.allowPrerelease).toBe(false)
  })

  it('does not launch a moving product feed when no stable tag can be verified', async () => {
    productUpdateSourceState.value = configuredProductSource('stable')
    appMock.getVersion.mockReturnValue('1.3.19-rc.6')
    fetchNewerReleaseTagsMock.mockResolvedValue([])
    const send = vi.fn()
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })
    const feedCallsBeforeCheck = autoUpdaterMock.setFeedURL.mock.calls.length

    checkForUpdatesFromMenu()

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith('updater:status', {
        state: 'not-available',
        userInitiated: true
      })
    })
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledTimes(feedCallsBeforeCheck)
  })

  it('fails closed when the Atom feed is unavailable', async () => {
    appMock.getVersion.mockReturnValue('1.4.141')
    fetchNewerReleaseTagsMock.mockResolvedValue({
      tags: [],
      state: 'unavailable',
      unavailableReason: 'feed'
    })
    const send = vi.fn()
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })
    const feedCallsBeforeCheck = autoUpdaterMock.setFeedURL.mock.calls.length

    checkForUpdatesFromMenu()

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith('updater:status', {
        state: 'error',
        message: "Couldn't reach the update server. Try again in a few minutes.",
        userInitiated: true
      })
    })
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledTimes(feedCallsBeforeCheck)
  })

  it('does not let a stale release preflight overwrite a newer pinned feed', async () => {
    let resolveBackgroundTags: (value: { tags: string[]; state: 'ready' }) => void = () => {}
    fetchNewerReleaseTagsMock.mockImplementationOnce(
      () =>
        new Promise<{ tags: string[]; state: 'ready' }>((resolve) => {
          resolveBackgroundTags = resolve
        })
    )
    autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')
    setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => null
    })
    await vi.waitFor(() => expect(fetchNewerReleaseTagsMock).toHaveBeenCalledTimes(1))

    checkForUpdatesFromMenu({ channel: 'stable', targetTag: 'v1.0.60' })
    await vi.waitFor(() => {
      expect(autoUpdaterMock.setFeedURL).toHaveBeenLastCalledWith({
        provider: 'generic',
        url: 'https://github.com/stablyai/orca/releases/download/v1.0.60'
      })
    })
    resolveBackgroundTags({ tags: ['v1.0.61'], state: 'ready' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(autoUpdaterMock.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://github.com/stablyai/orca/releases/download/v1.0.60'
    })
  })
})
