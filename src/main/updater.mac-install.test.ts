import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appMock,
  browserWindowMock,
  nativeUpdaterMock,
  autoUpdaterMock,
  shellMock,
  isMock,
  killAllPtyMock
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
      emit: appEmit,
      quit: vi.fn()
    },
    browserWindowMock: {
      getAllWindows: vi.fn(() => [])
    },
    nativeUpdaterMock: {
      on: vi.fn()
    },
    autoUpdaterMock,
    shellMock: {
      openExternal: vi.fn()
    },
    isMock: { dev: false },
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

vi.mock('./ipc/pty', () => ({
  killAllPty: killAllPtyMock
}))

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
    github: {
      repo: 'stablyai/orca',
      atomFeedUrl: 'https://github.com/stablyai/orca/releases.atom',
      releasesDownloadBase: 'https://github.com/stablyai/orca/releases/download',
      releasesApiUrl: 'https://api.github.com/repos/stablyai/orca/releases'
    }
  })
}))

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
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('poisons identity-free native readiness when a second physical generation starts', async () => {
    const macInstall = await import('./updater-mac-install')

    macInstall.beginMacUpdateDownload()
    expect(macInstall.captureMacDownloadGenerationForNativeReady()).toBe(1)
    macInstall.beginMacUpdateDownload()
    expect(macInstall.captureMacDownloadGenerationForNativeReady()).toBe(2)

    // Squirrel supplies no request identity, so either next signal could belong to either download.
    // The process must stay poisoned until restart rather than guessing FIFO order.
    const reportDownloaded = vi.fn()
    expect(macInstall.consumePendingMacNativeReadyGeneration()).toBeNull()
    expect(macInstall.isMacInstallerReady()).toBe(false)
    expect(reportDownloaded).not.toHaveBeenCalled()
    expect(macInstall.consumePendingMacNativeReadyGeneration()).toBeNull()
  })

  it('revokes readiness when an unexpected duplicate native signal arrives', async () => {
    const macInstall = await import('./updater-mac-install')
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    macInstall.beginMacUpdateDownload()
    const generation = macInstall.captureMacDownloadGenerationForNativeReady()
    expect(macInstall.consumePendingMacNativeReadyGeneration()).toBe(generation)

    macInstall.handleMacInstallerReady(generation, true, vi.fn(), vi.fn())
    expect(macInstall.isMacInstallerReady()).toBe(true)
    expect(macInstall.hasMacInstallAuthority()).toBe(true)

    expect(macInstall.consumePendingMacNativeReadyGeneration()).toBeNull()
    expect(macInstall.isMacInstallerReady()).toBe(false)
    expect(macInstall.hasMacInstallAuthority()).toBe(false)
  })

  it('invalidates a queued native-ready signal when mac install state is reset', async () => {
    const macInstall = await import('./updater-mac-install')
    macInstall.beginMacUpdateDownload()
    const generation = macInstall.captureMacDownloadGenerationForNativeReady()

    macInstall.resetMacInstallState()
    expect(macInstall.consumePendingMacNativeReadyGeneration()).toBeNull()
    const reportDownloaded = vi.fn()
    macInstall.handleMacInstallerReady(generation, true, vi.fn(), reportDownloaded)
    expect(macInstall.isMacInstallerReady()).toBe(false)
    expect(reportDownloaded).not.toHaveBeenCalled()
  })

  it('coalesces duplicate downloaded events for the same mac generation', async () => {
    const macInstall = await import('./updater-mac-install')
    macInstall.beginMacUpdateDownload()

    const generation = macInstall.captureMacDownloadGenerationForNativeReady()
    expect(macInstall.captureMacDownloadGenerationForNativeReady()).toBe(generation)
    expect(macInstall.consumePendingMacNativeReadyGeneration()).toBe(generation)
    expect(macInstall.consumePendingMacNativeReadyGeneration()).toBeNull()
  })

  it('reports downloaded before invoking a deferred native install handoff', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })

    const macInstall = await import('./updater-mac-install')
    macInstall.beginMacUpdateDownload()
    const generation = macInstall.captureMacDownloadGenerationForNativeReady()

    const onReadyToInstall = vi.fn()
    const onReadyToReportDownloaded = vi.fn()

    macInstall.deferMacQuitUntilInstallerReady(
      { state: 'downloading', percent: 100, version: '1.0.61' },
      true,
      () => '1.0.61',
      vi.fn()
    )

    macInstall.handleMacInstallerReady(
      generation,
      true,
      onReadyToInstall,
      onReadyToReportDownloaded
    )

    await vi.waitFor(() => {
      expect(onReadyToReportDownloaded).toHaveBeenCalled()
    })
    expect(onReadyToInstall).toHaveBeenCalled()
    expect(onReadyToReportDownloaded.mock.invocationCallOrder[0]).toBeLessThan(
      onReadyToInstall.mock.invocationCallOrder[0]
    )
  })

  it('accepts a public install request that is durably deferred until native readiness', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })

    const mainWindow = { webContents: { send: vi.fn() } }
    autoUpdaterMock.checkForUpdates.mockImplementation(() => new Promise(() => {}))
    autoUpdaterMock.downloadUpdate.mockResolvedValue([])
    const { downloadUpdate, getUpdateStatus, installRemoteServerUpdate, setupAutoUpdater } =
      await import('./updater')

    setupAutoUpdater(mainWindow as never)
    await vi.waitFor(() => {
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    })
    autoUpdaterMock.emit('checking-for-update')
    autoUpdaterMock.emit('update-available', { version: '1.0.61' })
    await vi.waitFor(() => {
      expect(getUpdateStatus()).toMatchObject({ state: 'available', version: '1.0.61' })
    })
    downloadUpdate()
    autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })

    expect(installRemoteServerUpdate('runtime-rpc')).toMatchObject({
      accepted: true,
      fromVersion: '1.0.51',
      targetVersion: '1.0.61',
      runtimeId: 'runtime-rpc'
    })
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  })

  it.runIf(process.platform === 'darwin')(
    'waits for Squirrel.Mac before honoring a manual quit that should install the update',
    async () => {
      const sendMock = vi.fn()
      const mainWindow = { webContents: { send: sendMock } }

      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater } = await import('./updater')

      setupAutoUpdater(mainWindow as never)
      await vi.waitFor(() => {
        expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
      })
      autoUpdaterMock.emit('checking-for-update')
      autoUpdaterMock.emit('update-available', { version: '1.0.61' })
      // Why: the update-available handler is now async (it awaits fetchChangelog).
      // Flush microtasks so setAvailableVersion runs before update-downloaded fires.
      await new Promise((r) => setTimeout(r, 0))
      autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })

      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })

      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()

      const nativeDownloadedHandler = nativeUpdaterMock.on.mock.calls.find(
        ([eventName]) => eventName === 'update-downloaded'
      )?.[1] as (() => void) | undefined
      expect(nativeDownloadedHandler).toBeTypeOf('function')

      nativeDownloadedHandler?.()

      await vi.waitFor(() => {
        expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledWith(false, true)
      })
      expect(sendMock).toHaveBeenCalledWith('updater:status', {
        state: 'downloading',
        percent: 100,
        version: '1.0.61'
      })
    }
  )

  it.runIf(process.platform === 'darwin')(
    'ignores duplicate quit requests while deferred mac install cleanup is running',
    async () => {
      vi.useFakeTimers()

      let finishCleanup!: () => void
      const onBeforeQuit = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishCleanup = resolve
          })
      )
      const mainWindow = { webContents: { send: vi.fn() } }

      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater, quitAndInstall } = await import('./updater')

      setupAutoUpdater(mainWindow as never, { onBeforeQuit })
      await vi.waitFor(() => {
        expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
      })
      autoUpdaterMock.emit('checking-for-update')
      autoUpdaterMock.emit('update-available', { version: '1.0.61' })
      await vi.advanceTimersByTimeAsync(0)
      autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })

      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(1)

      const nativeDownloadedHandler = nativeUpdaterMock.on.mock.calls.find(
        ([eventName]) => eventName === 'update-downloaded'
      )?.[1] as (() => void) | undefined
      expect(nativeDownloadedHandler).toBeTypeOf('function')

      nativeDownloadedHandler?.()
      await vi.advanceTimersByTimeAsync(0)

      expect(onBeforeQuit).toHaveBeenCalledTimes(1)
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()

      quitAndInstall()
      finishCleanup()
      await vi.advanceTimersByTimeAsync(0)

      expect(onBeforeQuit).toHaveBeenCalledTimes(1)
      expect(killAllPtyMock).toHaveBeenCalledTimes(1)
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
    }
  )

  it.runIf(process.platform === 'darwin')(
    'logs rejected deferred mac install handoffs without unhandled rejection',
    async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const reportDownloaded = vi.fn()
      const {
        beginMacUpdateDownload,
        captureMacDownloadGenerationForNativeReady,
        deferMacQuitUntilInstallerReady,
        handleMacInstallerReady
      } = await import('./updater-mac-install')

      beginMacUpdateDownload()
      const generation = captureMacDownloadGenerationForNativeReady()

      expect(
        deferMacQuitUntilInstallerReady(
          { state: 'downloading', percent: 100, version: '1.0.61' },
          true,
          () => '1.0.61',
          vi.fn()
        )
      ).toBe(true)

      handleMacInstallerReady(
        generation,
        true,
        async () => {
          throw new Error('handoff-secret')
        },
        reportDownloaded
      )
      await Promise.resolve()

      expect(reportDownloaded).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => {
        // Why: recordUpdaterLifecycle packs metadata into one console line.
        expect(warn).toHaveBeenCalledWith(
          '[updater] Deferred macOS install handoff failed {"errorType":"Error"}'
        )
      })
      expect(JSON.stringify(warn.mock.calls)).not.toContain('handoff-secret')
    }
  )

  it.runIf(process.platform === 'darwin')(
    'falls back to a normal quit if Squirrel.Mac never becomes ready',
    async () => {
      vi.useFakeTimers()

      const sendMock = vi.fn()
      const mainWindow = { webContents: { send: sendMock } }

      autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
      const { setupAutoUpdater } = await import('./updater')

      setupAutoUpdater(mainWindow as never)
      await vi.waitFor(() => {
        expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
      })
      autoUpdaterMock.emit('checking-for-update')
      autoUpdaterMock.emit('update-available', { version: '1.0.61' })
      // Why: the update-available handler is now async (it awaits fetchChangelog).
      // Flush microtasks so setAvailableVersion runs before update-downloaded fires.
      await vi.advanceTimersByTimeAsync(0)
      autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })

      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })

      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(appMock.quit).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(15000)

      expect(appMock.quit).toHaveBeenCalledTimes(1)

      const secondPreventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault: secondPreventDefault })
      expect(secondPreventDefault).not.toHaveBeenCalled()
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    }
  )
})
