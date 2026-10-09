import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'

const { appMock, autoUpdaterMock, chooseLocalBuildMock, moduleFactories, resetUpdaterMocks } =
  await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

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

warmUpdaterModule()

describe('updater SQLite downgrade protection', () => {
  beforeEach(() => resetUpdaterMocks())
  it.each(
    (['darwin', 'linux', 'win32'] as const).flatMap((platform) => [
      { platform, channel: 'stable' as const, targetTag: 'v1.4.213' },
      { platform, channel: 'beta' as const, targetTag: 'v1.5.0-beta.23' }
    ])
  )(
    'refuses $targetTag on $platform before configuring its feed',
    async ({ platform, channel, targetTag }) => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
      try {
        appMock.getVersion.mockReturnValue('1.5.0-beta.24')
        const send = vi.fn()
        const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The mocked updater only reads webContents.send from this window fixture.
        setupAutoUpdater({ webContents: { send } } as never, {
          getLastUpdateCheckAt: () => Date.now()
        })
        autoUpdaterMock.setFeedURL.mockClear()
        checkForUpdatesFromMenu({ channel, targetTag })
        await vi.waitFor(() =>
          expect(send).toHaveBeenCalledWith('updater:status', {
            state: 'error',
            message: expect.stringContaining('SQLite profile baseline'),
            userInitiated: true
          })
        )
        expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
        expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
      } finally {
        platformSpy.mockRestore()
      }
    }
  )

  it.each(['1.4.213', '1.5.0-beta.23'])(
    'closes incompatible local build %s before opening a feed',
    async (version) => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
      try {
        appMock.getVersion.mockReturnValue('1.5.0-beta.24')
        const close = vi.fn().mockResolvedValue(undefined)
        chooseLocalBuildMock.mockResolvedValue({ version, close })
        const send = vi.fn()
        const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The mocked updater only reads webContents.send from this window fixture.
        setupAutoUpdater({ webContents: { send } } as never, {
          getLastUpdateCheckAt: () => Date.now()
        })
        checkForUpdatesFromMenu({ localBuild: true })
        await vi.waitFor(() =>
          expect(send).toHaveBeenCalledWith(
            'updater:status',
            expect.objectContaining({
              state: 'error',
              message: expect.stringContaining('SQLite profile baseline')
            })
          )
        )
        expect(close).toHaveBeenCalledOnce()
        expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
      } finally {
        platformSpy.mockRestore()
      }
    }
  )

  it('allows a pinned downgrade that stays at the reviewed SQLite baseline', async () => {
    appMock.getVersion.mockReturnValue('1.5.0-beta.25')
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The mocked updater only reads webContents.send from this window fixture.
    setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now()
    })
    autoUpdaterMock.setFeedURL.mockClear()
    checkForUpdatesFromMenu({ channel: 'beta', targetTag: 'v1.5.0-beta.24' })
    await vi.waitFor(() => expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce())
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://github.com/stablyai/orca/releases/download/v1.5.0-beta.24'
    })
    expect(autoUpdaterMock.allowDowngrade).toBe(true)
  })
})
