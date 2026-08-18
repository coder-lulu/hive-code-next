import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as UpdaterModule from './updater'

const {
  autoUpdaterMock,
  killAllPtyMock,
  fetchNewerReleaseTagsMock,
  productUpdatePolicy,
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

async function reachVerifiedAvailableUpdate(
  updater: typeof UpdaterModule,
  version: string
): Promise<void> {
  fetchNewerReleaseTagsMock.mockResolvedValue({ tags: [`v${version}`], state: 'ready' })
  autoUpdaterMock.downloadUpdate.mockResolvedValue([])
  autoUpdaterMock.checkForUpdates.mockImplementationOnce(() => {
    autoUpdaterMock.emit('checking-for-update')
    queueMicrotask(() => autoUpdaterMock.emit('update-available', { version }))
    return Promise.resolve(undefined)
  })
  updater.checkForUpdatesFromMenu()
  await vi.waitFor(() => {
    expect(updater.getUpdateStatus()).toEqual(
      expect.objectContaining({ state: 'available', version })
    )
  })
}

describe('updater candidate fencing', () => {
  beforeEach(() => {
    resetUpdaterMocks()
  })

  it('rejects quitAndInstall when no downloaded update or recovery exists', async () => {
    vi.useFakeTimers()
    const { setupAutoUpdater, quitAndInstall } = await import('./updater')
    setupAutoUpdater({ webContents: { send: vi.fn() } } as never)

    quitAndInstall()
    await vi.advanceTimersByTimeAsync(100)

    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    expect(killAllPtyMock).not.toHaveBeenCalled()
  })

  it('rejects an update offer whose version differs from the verified concrete tag', async () => {
    fetchNewerReleaseTagsMock.mockResolvedValue(['v1.0.52'])
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      autoUpdaterMock.emit('update-available', { version: '9.9.9' })
      return Promise.resolve(undefined)
    })
    const send = vi.fn()
    const { checkForUpdatesFromMenu, setupAutoUpdater } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })

    checkForUpdatesFromMenu()

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith('updater:status', {
        state: 'error',
        message: 'Update metadata did not match the verified release tag.',
        userInitiated: true
      })
    })
    expect(send).not.toHaveBeenCalledWith(
      'updater:status',
      expect.objectContaining({ state: 'available' })
    )
  })

  it('revokes an available candidate when its repository or channel changes', async () => {
    const updater = await import('./updater')
    updater.setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })
    await reachVerifiedAvailableUpdate(updater, '1.0.52')

    productUpdateSourceState.value = {
      channel: 'rc',
      feedUrl: 'https://github.com/coder-lulu/hive-code/releases/latest/download',
      github: {
        repo: 'coder-lulu/hive-code',
        atomFeedUrl: 'https://github.com/coder-lulu/hive-code/releases.atom',
        releasesDownloadBase: 'https://github.com/coder-lulu/hive-code/releases/download',
        releasesApiUrl: 'https://api.github.com/repos/coder-lulu/hive-code/releases'
      }
    }
    updater.downloadUpdate()

    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
  })

  it('rejects a downloaded version that differs from the available candidate', async () => {
    const updater = await import('./updater')
    updater.setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })
    await reachVerifiedAvailableUpdate(updater, '1.0.52')
    updater.downloadUpdate()
    autoUpdaterMock.emit('update-downloaded', { version: '9.9.9' })

    vi.useFakeTimers()
    updater.quitAndInstall()
    await vi.advanceTimersByTimeAsync(100)

    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })

  it('does not let a late downloaded event from an older generation arm install', async () => {
    const updater = await import('./updater')
    updater.setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })
    await reachVerifiedAvailableUpdate(updater, '1.0.52')
    updater.downloadUpdate()

    fetchNewerReleaseTagsMock.mockImplementationOnce(() => new Promise(() => undefined))
    updater.checkForUpdatesFromMenu()
    expect(updater.getUpdateStatus()).toEqual(expect.objectContaining({ state: 'checking' }))
    autoUpdaterMock.emit('update-downloaded', { version: '1.0.52' })

    vi.useFakeTimers()
    updater.quitAndInstall()
    await vi.advanceTimersByTimeAsync(100)

    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })

  it('does not install a downloaded candidate after its source is revoked', async () => {
    const updater = await import('./updater')
    updater.setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })
    await reachVerifiedAvailableUpdate(updater, '1.0.52')
    updater.downloadUpdate()
    autoUpdaterMock.emit('update-downloaded', { version: '1.0.52' })

    productUpdatePolicy.configured = false
    productUpdateSourceState.value = null
    vi.useFakeTimers()
    updater.quitAndInstall()
    await vi.advanceTimersByTimeAsync(100)

    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })
})
