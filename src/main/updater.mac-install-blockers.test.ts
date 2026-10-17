import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ServeSupervisorInstallPark from './updater/serve-supervisor-install-park'
import { APP_DISPLAY_NAME } from '../shared/brand'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'

const {
  appMock,
  browserWindowMock,
  nativeUpdaterMock,
  autoUpdaterMock,
  shellMock,
  isMock,
  killAllPtyMock,
  getMacUpdateRunningInstancesMock,
  prepareShipItStagingMock,
  recoverBrowserSidecarsMock,
  describeBrowserBlockersMock
} = vi.hoisted(() => {
  const appEventHandlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const eventHandlers = new Map<string, ((...args: unknown[]) => void)[]>()

  const appOn = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    const handlers = appEventHandlers.get(event) ?? []
    handlers.push(handler)
    appEventHandlers.set(event, handlers)
    return appMock
  })

  const appEmit = (event: string, ...args: unknown[]) => {
    for (const handler of appEventHandlers.get(event) ?? []) {
      handler(...args)
    }
  }

  const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    const handlers = eventHandlers.get(event) ?? []
    handlers.push(handler)
    eventHandlers.set(event, handlers)
    return autoUpdaterMock
  })

  const emit = (event: string, ...args: unknown[]) => {
    for (const handler of eventHandlers.get(event) ?? []) {
      handler(...args)
    }
  }

  const reset = () => {
    appEventHandlers.clear()
    appOn.mockClear()
    eventHandlers.clear()
    on.mockClear()
    autoUpdaterMock.checkForUpdates.mockReset()
    autoUpdaterMock.downloadUpdate.mockReset()
    autoUpdaterMock.quitAndInstall.mockReset()
  }

  const autoUpdaterMock = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
    emit,
    reset
  }

  return {
    appMock: {
      isPackaged: true,
      getVersion: vi.fn(() => '1.0.51'),
      on: appOn,
      prependListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        appEventHandlers.set(event, [handler, ...(appEventHandlers.get(event) ?? [])])
      }),
      emit: appEmit,
      quit: vi.fn()
    },
    browserWindowMock: {
      getAllWindows: vi.fn(() => [])
    },
    nativeUpdaterMock: {
      on: vi.fn(),
      checkForUpdates: vi.fn()
    },
    autoUpdaterMock,
    shellMock: {
      openExternal: vi.fn()
    },
    isMock: { dev: false },
    getMacUpdateRunningInstancesMock: vi.fn(async (): Promise<number[]> => []),
    recoverBrowserSidecarsMock: vi.fn(async (_executable: string, pids: number[]) => pids),
    describeBrowserBlockersMock: vi.fn(async (_executable: string, pids: number[]) =>
      pids.map((pid) => ({ pid, kind: 'unknown' as const }))
    ),
    prepareShipItStagingMock: vi.fn((): Promise<boolean> | null => Promise.resolve(true)),
    killAllPtyMock: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: browserWindowMock,
  autoUpdater: nativeUpdaterMock,
  powerMonitor: { on: vi.fn() },
  shell: shellMock,
  net: { fetch: vi.fn() }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: autoUpdaterMock
}))

vi.mock('./electron-updater-loader', () => ({
  loadElectronAutoUpdater: () => autoUpdaterMock
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: isMock
}))

vi.mock('./ipc/pty/kill-all', () => ({ killAllPty: killAllPtyMock }))

vi.mock('./updater-changelog', () => ({
  fetchChangelog: vi.fn().mockResolvedValue(null)
}))

vi.mock('./updater-nudge', () => ({
  fetchNudge: vi.fn().mockResolvedValue(null),
  shouldApplyNudge: vi.fn().mockReturnValue(false)
}))

vi.mock('./updater-prerelease-feed', () => ({
  fetchNewerReleaseTagsWithReadiness: vi
    .fn()
    .mockResolvedValue({ tags: ['v1.0.61'], state: 'ready' }),
  getReleaseDownloadUrl: (tag: string) =>
    `https://github.com/stablyai/orca/releases/download/${tag}`
}))

vi.mock('./product/product-updater-network-boundary', () => ({
  installProductUpdaterNetworkBoundary: vi.fn()
}))

vi.mock('../shared/product-update-policy', () => ({
  hasConfiguredProductUpdateChannel: () => true
}))

vi.mock('../shared/product-update-source', () => ({
  resolveProductUpdateSource: () => ({
    channel: 'stable',
    feedUrl: 'https://github.com/stablyai/orca/releases/latest/download',
    provider: 'github',
    github: {
      repo: 'stablyai/orca',
      atomFeedUrl: 'https://github.com/stablyai/orca/releases.atom',
      releasesDownloadBase: 'https://github.com/stablyai/orca/releases/download',
      releasesApiUrl: 'https://api.github.com/repos/stablyai/orca/releases'
    }
  }),
  resolveProductUpdateFeedUrl: (source: { feedUrl: string }) => source.feedUrl
}))
vi.mock('./updater/shipit-leftover-recovery', () => ({
  prepareThisProcessShipItStaging: prepareShipItStagingMock
}))

vi.mock('./macos-update-running-instances', () => ({
  getMacUpdateRunningInstances: getMacUpdateRunningInstancesMock
}))

vi.mock('./updater/mac-browser-sidecar-recovery', () => ({
  recoverMacBrowserSidecars: recoverBrowserSidecarsMock,
  describeMacUpdateBlockers: describeBrowserBlockersMock
}))

// Why: no registered serve supervisors here, so every blocker is refused as before parking existed.
vi.mock('./updater/serve-supervisor-install-park', async (importOriginal) => ({
  ...(await importOriginal<typeof ServeSupervisorInstallPark>()),
  parkServeSupervisorsForInstall: (_executable: string, blockers: number[]) => ({
    kind: 'refused',
    reason: 'unregistered',
    pids: blockers
  }),
  commitServeSupervisorPark: async () => undefined,
  releaseServeSupervisorPark: async () => undefined
}))

warmUpdaterModule()

async function prepareStagedMacUpdate(downloadUpdate: () => void): Promise<void> {
  await vi.waitFor(() => expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1))
  autoUpdaterMock.emit('checking-for-update')
  autoUpdaterMock.emit('update-available', { version: '1.0.61' })
  await vi.advanceTimersByTimeAsync(0)
  downloadUpdate()
  autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })
  const nativeReady = nativeUpdaterMock.on.mock.calls.find(
    ([event]) => event === 'update-downloaded'
  )?.[1]
  nativeReady?.()
}

describe('updater mac install handoff', () => {
  beforeEach(() => {
    vi.resetModules()
    autoUpdaterMock.reset()
    nativeUpdaterMock.on.mockReset()
    browserWindowMock.getAllWindows.mockReset()
    browserWindowMock.getAllWindows.mockReturnValue([])
    shellMock.openExternal.mockReset()
    appMock.getVersion.mockReset()
    appMock.getVersion.mockReturnValue('1.0.51')
    appMock.quit.mockReset()
    appMock.isPackaged = true
    isMock.dev = false
    killAllPtyMock.mockReset()
    getMacUpdateRunningInstancesMock.mockReset().mockResolvedValue([])
    recoverBrowserSidecarsMock
      .mockReset()
      .mockImplementation(async (_executable: string, pids: number[]) => pids)
    describeBrowserBlockersMock
      .mockReset()
      .mockImplementation(async (_executable: string, pids: number[]) =>
        pids.map((pid) => ({ pid, kind: 'unknown' as const }))
      )
    prepareShipItStagingMock.mockReset().mockResolvedValue(true)
    autoUpdaterMock.downloadUpdate.mockResolvedValue([])
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.runIf(process.platform === 'darwin')(
    'keeps the app and terminals open when another bundle instance blocks installation, then allows retry',
    async () => {
      vi.useFakeTimers()
      const send = vi.fn()
      const onBeforeQuit = vi.fn()
      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater, downloadUpdate, quitAndInstall, isQuittingForUpdate } =
        await loadUpdaterModule()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The updater only reads webContents.send from this window fixture.
      setupAutoUpdater({ webContents: { send } } as never, { onBeforeQuit })
      await prepareStagedMacUpdate(downloadUpdate)
      getMacUpdateRunningInstancesMock.mockResolvedValue([9654, 10718])
      let finishDescription: () => void = () => undefined
      describeBrowserBlockersMock.mockImplementationOnce(async (_executable, pids) => {
        await new Promise<void>((resolve) => {
          finishDescription = resolve
        })
        return pids.map((pid) => ({ pid, kind: 'unknown' as const }))
      })

      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      expect(describeBrowserBlockersMock).toHaveBeenCalledOnce()
      expect(isQuittingForUpdate()).toBe(true)
      expect(send).not.toHaveBeenCalledWith('updater:quitAndInstallAborted')
      const probeCount = getMacUpdateRunningInstancesMock.mock.calls.length
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      expect(getMacUpdateRunningInstancesMock).toHaveBeenCalledTimes(probeCount)
      finishDescription()
      await vi.advanceTimersByTimeAsync(0)

      expect(onBeforeQuit).not.toHaveBeenCalled()
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
      expect(killAllPtyMock).not.toHaveBeenCalled()
      expect(isQuittingForUpdate()).toBe(false)
      expect(send).toHaveBeenCalledWith('updater:quitAndInstallAborted')
      expect(send).toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({
          state: 'error',
          message: expect.stringContaining('9654, 10718'),
          retryAction: 'install',
          installBlock: {
            reason: 'running-instances',
            instances: [
              { pid: 9654, kind: 'unknown' },
              { pid: 10718, kind: 'unknown' }
            ]
          }
        })
      )

      getMacUpdateRunningInstancesMock.mockResolvedValue([])
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      expect(onBeforeQuit).toHaveBeenCalledTimes(1)
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
    }
  )

  it.runIf(process.platform === 'darwin')(
    'recovers orphan browser blockers before native install without asking for another download',
    async () => {
      vi.useFakeTimers()
      const send = vi.fn()
      const onBeforeQuit = vi.fn()
      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater, downloadUpdate, quitAndInstall } = await loadUpdaterModule()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Only webContents.send is read from this window fixture.
      setupAutoUpdater({ webContents: { send } } as never, { onBeforeQuit })
      await prepareStagedMacUpdate(downloadUpdate)
      getMacUpdateRunningInstancesMock.mockResolvedValue([9654])
      recoverBrowserSidecarsMock.mockResolvedValue([])
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      expect(recoverBrowserSidecarsMock).toHaveBeenCalledWith(process.execPath, [9654])
      expect(send).toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({
          state: 'downloaded',
          installing: true
        })
      )
      expect(onBeforeQuit).toHaveBeenCalledOnce()
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce()
      expect(send).not.toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({ installBlock: expect.anything() })
      )
    }
  )

  it.runIf(process.platform === 'darwin')(
    'keeps the app open when process enumeration fails',
    async () => {
      vi.useFakeTimers()
      const send = vi.fn()
      const onBeforeQuit = vi.fn()
      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater, downloadUpdate, quitAndInstall, isQuittingForUpdate } =
        await loadUpdaterModule()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The updater only reads webContents.send from this window fixture.
      setupAutoUpdater({ webContents: { send } } as never, { onBeforeQuit })
      await prepareStagedMacUpdate(downloadUpdate)
      getMacUpdateRunningInstancesMock.mockRejectedValue(new Error('probe failed'))
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      expect(onBeforeQuit).not.toHaveBeenCalled()
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
      expect(isQuittingForUpdate()).toBe(false)
      expect(send).toHaveBeenCalledWith('updater:quitAndInstallAborted')
      expect(send).toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({
          state: 'error',
          message: expect.stringContaining('Could not check'),
          retryAction: 'install'
        })
      )
      expect(send).toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({
          message: expect.stringMatching(
            new RegExp(
              `close the other ${APP_DISPLAY_NAME} instances.*quit ${APP_DISPLAY_NAME}`,
              'i'
            )
          )
        })
      )
    }
  )

  it.runIf(process.platform === 'darwin')(
    'leaves an ordinary quit with a staged update to Squirrel instead of starting a relaunching install',
    async () => {
      vi.useFakeTimers()
      const onBeforeQuit = vi.fn()
      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater, downloadUpdate } = await loadUpdaterModule()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The updater only reads webContents.send from this window fixture.
      setupAutoUpdater({ webContents: { send: vi.fn() } } as never, { onBeforeQuit })
      await prepareStagedMacUpdate(downloadUpdate)
      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })
      appMock.emit('before-quit', { preventDefault })
      await vi.advanceTimersByTimeAsync(0)
      expect(preventDefault).not.toHaveBeenCalled()
      expect(getMacUpdateRunningInstancesMock).not.toHaveBeenCalled()
      expect(onBeforeQuit).not.toHaveBeenCalled()
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    }
  )

  it.runIf(process.platform === 'darwin')(
    'blocks duplicate quits while the running-instance check is pending',
    async () => {
      vi.useFakeTimers()
      const onBeforeQuit = vi.fn()
      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater, downloadUpdate, quitAndInstall } = await loadUpdaterModule()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The updater only reads webContents.send from this window fixture.
      setupAutoUpdater({ webContents: { send: vi.fn() } } as never, { onBeforeQuit })
      await prepareStagedMacUpdate(downloadUpdate)

      let finishProbe: (pids: number[]) => void = () => {}
      getMacUpdateRunningInstancesMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishProbe = resolve
          })
      )
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })
      appMock.emit('before-quit', { preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(2)
      expect(getMacUpdateRunningInstancesMock).toHaveBeenCalledTimes(1)
      finishProbe([9654])
      await vi.advanceTimersByTimeAsync(0)
      expect(onBeforeQuit).not.toHaveBeenCalled()
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    }
  )

  it.runIf(process.platform === 'darwin')(
    'allows ordinary quitting after a refused install without requiring background servers to exit',
    async () => {
      vi.useFakeTimers()
      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater, downloadUpdate, quitAndInstall } = await loadUpdaterModule()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The updater only reads webContents.send from this window fixture.
      setupAutoUpdater({ webContents: { send: vi.fn() } } as never)
      await prepareStagedMacUpdate(downloadUpdate)
      getMacUpdateRunningInstancesMock.mockResolvedValue([9654])
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })
      expect(preventDefault).not.toHaveBeenCalled()
      // The main will-quit handler requests quit again after asynchronous teardown.
      appMock.emit('before-quit', { preventDefault })
      expect(preventDefault).not.toHaveBeenCalled()
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    }
  )

  it.runIf(process.platform === 'darwin')(
    'prevents duplicate quits until asynchronous update cleanup finishes',
    async () => {
      vi.useFakeTimers()
      let finishCleanup = (): void => {}
      const onBeforeQuit = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishCleanup = resolve
          })
      )
      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater, downloadUpdate, quitAndInstall } = await loadUpdaterModule()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The updater only reads webContents.send from this window fixture.
      setupAutoUpdater({ webContents: { send: vi.fn() } } as never, { onBeforeQuit })
      await prepareStagedMacUpdate(downloadUpdate)
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      expect(onBeforeQuit).toHaveBeenCalledTimes(1)
      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
      finishCleanup()
      await vi.advanceTimersByTimeAsync(0)
      const nativePreventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault: nativePreventDefault })
      expect(nativePreventDefault).not.toHaveBeenCalled()
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
    }
  )

  it.runIf(process.platform === 'darwin')(
    'cannot use a previous refusal to bypass a pending retry check',
    async () => {
      vi.useFakeTimers()
      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater, downloadUpdate, quitAndInstall } = await loadUpdaterModule()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The updater only reads webContents.send from this window fixture.
      setupAutoUpdater({ webContents: { send: vi.fn() } } as never)
      await prepareStagedMacUpdate(downloadUpdate)
      getMacUpdateRunningInstancesMock.mockResolvedValue([9654])
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      let finishProbe = (_pids: number[]): void => {}
      getMacUpdateRunningInstancesMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishProbe = resolve
          })
      )
      quitAndInstall()
      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })
      expect(preventDefault).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1000)
      appMock.emit('before-quit', { preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(2)
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
      finishProbe([])
      await vi.advanceTimersByTimeAsync(0)
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce()
    }
  )

  it.runIf(process.platform === 'darwin')(
    'permits ordinary shutdown after required update cleanup rejects',
    async () => {
      vi.useFakeTimers()
      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const onBeforeQuit = vi.fn().mockRejectedValue(new Error('required cleanup failed'))
      const { setupAutoUpdater, downloadUpdate, quitAndInstall } = await loadUpdaterModule()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The updater only reads webContents.send from this window fixture.
      setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
        onBeforeQuit,
        onBeforeQuitFailure: 'abort'
      })
      await prepareStagedMacUpdate(downloadUpdate)
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })
      appMock.emit('before-quit', { preventDefault })
      expect(preventDefault).not.toHaveBeenCalled()
      expect(onBeforeQuit).toHaveBeenCalledOnce()
    }
  )

  it.runIf(process.platform === 'darwin')(
    'keeps the install target and quit guard when checks or downloads are requested during a retry',
    async () => {
      vi.useFakeTimers()
      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const {
        setupAutoUpdater,
        downloadUpdate,
        quitAndInstall,
        checkForUpdates,
        checkForUpdatesFromMenu,
        getUpdateStatus
      } = await loadUpdaterModule()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The updater only reads webContents.send from this window fixture.
      setupAutoUpdater({ webContents: { send: vi.fn() } } as never)
      await prepareStagedMacUpdate(downloadUpdate)
      getMacUpdateRunningInstancesMock.mockResolvedValue([9654])
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(1000)
      let finishProbe = (_pids: number[]): void => {}
      getMacUpdateRunningInstancesMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishProbe = resolve
          })
      )
      const checks = autoUpdaterMock.checkForUpdates.mock.calls.length
      const downloads = autoUpdaterMock.downloadUpdate.mock.calls.length
      autoUpdaterMock.checkForUpdates.mockImplementation(() => {
        autoUpdaterMock.emit('checking-for-update')
        return Promise.resolve(undefined)
      })
      const requestCompetingActions = (): void => {
        checkForUpdatesFromMenu()
        checkForUpdatesFromMenu({ localBuild: true })
        checkForUpdatesFromMenu({ channel: 'stable', targetTag: 'v1.0.70' })
        checkForUpdates()
        downloadUpdate()
      }
      quitAndInstall()
      requestCompetingActions()
      await vi.advanceTimersByTimeAsync(1000)
      requestCompetingActions()
      await vi.advanceTimersByTimeAsync(0)
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(checks)
      expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(downloads)
      expect(getUpdateStatus()).toEqual({
        state: 'downloaded',
        version: '1.0.61',
        installing: true
      })
      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })
      expect(preventDefault).toHaveBeenCalledOnce()
      finishProbe([])
      await vi.advanceTimersByTimeAsync(0)
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce()
    }
  )
})
