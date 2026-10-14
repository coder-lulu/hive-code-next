import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule } from './updater-test-module-loader'
import { MAC_DEFERRED_STAGING_TIMEOUT_MS } from './updater-events-context'
import type { BrowserWindow } from 'electron'

function windowSending(send: ReturnType<typeof vi.fn>): BrowserWindow {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the updater only reaches the window through webContents.send.
  return { webContents: { send } } as unknown as BrowserWindow
}
import { PRIMARY_CLI_COMMAND } from '../shared/brand'

const {
  appMock,
  autoUpdaterMock,
  nativeUpdaterMock,
  killAllPtyMock,
  recordUpdaterLifecycleMock,
  requestServeUpdateHandoffMock,
  failServeUpdateHandoffMock,
  armUpdateInstallExitWatchdogMock,
  resetHandlers
} = vi.hoisted(() => {
  const appHandlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const updaterHandlers = new Map<string, ((...args: unknown[]) => void)[]>()

  const emit = (
    handlers: Map<string, ((...args: unknown[]) => void)[]>,
    event: string,
    ...args: unknown[]
  ): void => {
    for (const handler of handlers.get(event) ?? []) {
      handler(...args)
    }
  }

  const appMock = {
    isPackaged: true,
    getVersion: vi.fn(() => '1.0.51'),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      appHandlers.set(event, [...(appHandlers.get(event) ?? []), handler])
      return appMock
    }),
    prependListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      appHandlers.set(event, [handler, ...(appHandlers.get(event) ?? [])])
      return appMock
    }),
    emit: (event: string, ...args: unknown[]) => emit(appHandlers, event, ...args),
    quit: vi.fn()
  }

  const autoUpdaterMock = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: true,
    allowPrerelease: false,
    checkForUpdates: vi.fn().mockResolvedValue(null),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      updaterHandlers.set(event, [...(updaterHandlers.get(event) ?? []), handler])
      return autoUpdaterMock
    }),
    emit: (event: string, ...args: unknown[]) => emit(updaterHandlers, event, ...args)
  }

  return {
    appMock,
    autoUpdaterMock,
    nativeUpdaterMock: { on: vi.fn(), checkForUpdates: vi.fn() },
    killAllPtyMock: vi.fn(),
    recordUpdaterLifecycleMock: vi.fn(),
    requestServeUpdateHandoffMock: vi.fn(() => true),
    failServeUpdateHandoffMock: vi.fn(),
    armUpdateInstallExitWatchdogMock: vi.fn(),
    resetHandlers: () => {
      appHandlers.clear()
      updaterHandlers.clear()
    }
  }
})

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  autoUpdater: nativeUpdaterMock,
  powerMonitor: { on: vi.fn() },
  shell: { openExternal: vi.fn() },
  net: { fetch: vi.fn() }
}))

vi.mock('./product/product-updater-network-boundary', () => ({
  installProductUpdaterNetworkBoundary: vi.fn()
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

vi.mock('electron-updater', () => ({ autoUpdater: autoUpdaterMock }))
vi.mock('./electron-updater-loader', () => ({ loadElectronAutoUpdater: () => autoUpdaterMock }))
vi.mock('./linux-update-package-type', () => ({
  getLinuxPackageType: () => 'non-root',
  getLinuxRootPackageType: () => null,
  isExternallyManagedLinuxInstall: () => false
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./ipc/pty/kill-all', () => ({ killAllPty: killAllPtyMock }))
vi.mock('./updater-changelog', () => ({ fetchChangelog: vi.fn().mockResolvedValue(null) }))
vi.mock('./updater-nudge', () => ({
  fetchNudge: vi.fn().mockResolvedValue(null),
  shouldApplyNudge: vi.fn().mockReturnValue(false)
}))
vi.mock('./updater-prerelease-feed', () => ({
  fetchNewerReleaseTagsWithReadiness: vi.fn().mockResolvedValue({
    tags: ['v1.0.61'],
    state: 'ready'
  }),
  getReleaseDownloadUrl: vi.fn(
    (tag: string) => `https://github.com/stablyai/orca/releases/download/${tag}`
  )
}))
vi.mock('./update-install-exit-watchdog', () => ({
  armUpdateInstallExitWatchdog: armUpdateInstallExitWatchdogMock,
  disarmUpdateInstallExitWatchdog: vi.fn()
}))
vi.mock('./updater-lifecycle-diagnostics', () => ({
  recordUpdaterLifecycle: recordUpdaterLifecycleMock
}))
const prepareShipItStagingMock = vi.hoisted(() =>
  vi.fn((): Promise<boolean> | null => Promise.resolve(true))
)
vi.mock('./updater/shipit-leftover-recovery', () => ({
  prepareThisProcessShipItStaging: prepareShipItStagingMock
}))

vi.mock('./serve-update-handoff', () => ({
  failServeUpdateHandoff: failServeUpdateHandoffMock,
  getServeUpdateHandoffFailure: vi.fn(() => null),
  hasServeUpdateSupervisor: vi.fn(() => true),
  requestServeUpdateHandoff: requestServeUpdateHandoffMock
}))

function expectNoInstallerQuit(): void {
  expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
  expect(appMock.quit).not.toHaveBeenCalled()
}

describe('headless serve update install handoff', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    autoUpdaterMock.checkForUpdates.mockReset().mockResolvedValue(null)
    autoUpdaterMock.downloadUpdate.mockReset().mockResolvedValue([])
    autoUpdaterMock.quitAndInstall.mockReset()
    autoUpdaterMock.setFeedURL.mockReset()
    autoUpdaterMock.on.mockClear()
    autoUpdaterMock.autoInstallOnAppQuit = false
    autoUpdaterMock.autoRunAppAfterInstall = true
    nativeUpdaterMock.on.mockReset()
    nativeUpdaterMock.checkForUpdates.mockReset()
    appMock.getVersion.mockReturnValue('1.0.51')
    appMock.on.mockClear()
    appMock.quit.mockReset()
    killAllPtyMock.mockReset()
    recordUpdaterLifecycleMock.mockReset()
    requestServeUpdateHandoffMock.mockReset().mockReturnValue(true)
    failServeUpdateHandoffMock.mockReset()
    armUpdateInstallExitWatchdogMock.mockReset()
    prepareShipItStagingMock.mockReset().mockResolvedValue(true)
    resetHandlers()
  })

  it('ignores a late staged update after refusing an unsupported serving-owner download', async () => {
    const lifecycle: string[] = []
    const pendingInstaller = { version: '1.0.61', staged: true }
    const servingOwner = { version: '1.0.51', connectedClients: 2, verified: true }
    const replacementOwner: { version: string; verified: boolean } | null = null
    const send = vi.fn()
    const beginSessionCleanup = vi.fn(() => lifecycle.push('session-cleanup'))
    const disconnectPairedClients = vi.fn(() => {
      lifecycle.push('paired-clients-disconnected')
      servingOwner.connectedClients = 0
      servingOwner.verified = false
    })

    appMock.on('will-quit', disconnectPairedClients)
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => {
        autoUpdaterMock.emit('update-available', { version: pendingInstaller.version })
      })
      return Promise.resolve(null)
    })
    autoUpdaterMock.quitAndInstall.mockImplementation(() => {
      lifecycle.push('native-quit-and-install')
      appMock.emit('will-quit', { preventDefault: vi.fn() })
    })
    killAllPtyMock.mockImplementation(beginSessionCleanup)

    const { checkForUpdatesFromMenu, quitAndInstall, setupAutoUpdater } = await import('./updater')
    setupAutoUpdater(
      { webContents: { send } } as never,
      {
        getLastUpdateCheckAt: () => Date.now(),
        installMode: 'unsupported-headless-serve'
      } as never
    )

    checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    ;(await import('./updater')).downloadUpdate()
    autoUpdaterMock.emit('update-downloaded', { version: pendingInstaller.version })
    const nativeReadyHandler = nativeUpdaterMock.on.mock.calls.find(
      ([event]) => event === 'update-downloaded'
    )?.[1] as (() => void) | undefined
    nativeReadyHandler?.()
    await vi.advanceTimersByTimeAsync(0)

    expect(send).not.toHaveBeenCalledWith(
      'updater:status',
      expect.objectContaining({ state: 'downloaded', version: pendingInstaller.version })
    )
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    quitAndInstall()
    quitAndInstall()
    await vi.advanceTimersByTimeAsync(100)
    quitAndInstall()
    await vi.advanceTimersByTimeAsync(100)

    const statuses = send.mock.calls
      .filter(([channel]) => channel === 'updater:status')
      .map(([, status]) => status)
    expect({
      nativeInstallCalls: autoUpdaterMock.quitAndInstall.mock.calls.length,
      pairedClientDisconnects: disconnectPairedClients.mock.calls.length,
      sessionCleanupStarts: beginSessionCleanup.mock.calls.length,
      servingOwner,
      replacementOwner,
      pendingInstaller,
      deferredStatusVisible: statuses.some(
        (status) =>
          status &&
          typeof status === 'object' &&
          'state' in status &&
          status.state === 'error' &&
          'message' in status &&
          typeof status.message === 'string' &&
          status.message.includes(`${PRIMARY_CLI_COMMAND} serve`)
      ),
      deferralDiagnostics: recordUpdaterLifecycleMock.mock.calls.filter(
        ([event]) => event === 'headless_serve_install_deferred'
      ).length,
      lifecycle
    }).toEqual({
      nativeInstallCalls: 0,
      pairedClientDisconnects: 0,
      sessionCleanupStarts: 0,
      servingOwner: { version: '1.0.51', connectedClients: 2, verified: true },
      replacementOwner: null,
      pendingInstaller: { version: '1.0.61', staged: true },
      deferredStatusVisible: true,
      deferralDiagnostics: 1,
      lifecycle: []
    })
  })

  it('blocks staging and install-on-quit while still reporting an available update', async () => {
    const send = vi.fn()
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
      return Promise.resolve(null)
    })

    const { checkForUpdatesFromMenu, downloadUpdate, setupAutoUpdater } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never, {
      getLastUpdateCheckAt: () => Date.now(),
      installMode: 'unsupported-headless-serve'
    })
    checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)

    expect(send).toHaveBeenCalledWith(
      'updater:status',
      expect.objectContaining({ state: 'available', version: '1.0.61' })
    )

    downloadUpdate()
    downloadUpdate()

    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    expect(
      recordUpdaterLifecycleMock.mock.calls.filter(
        ([event, data]) =>
          event === 'headless_serve_install_deferred' &&
          data &&
          typeof data === 'object' &&
          'phase' in data &&
          data.phase === 'download'
      )
    ).toHaveLength(1)
    expect(
      send.mock.calls.filter(
        ([channel, status]) => channel === 'updater:status' && status?.state === 'error'
      )
    ).toHaveLength(1)
  })

  it('hands a supervised install to the serve parent before native quit and cleanup', async () => {
    const lifecycle: string[] = []
    const daemonSession = { alive: true }
    const send = vi.fn()
    const disconnectPairedClients = vi.fn(() => lifecycle.push('paired-clients-disconnected'))
    appMock.on('will-quit', disconnectPairedClients)
    requestServeUpdateHandoffMock.mockImplementation(() => {
      lifecycle.push('handoff-persisted')
      return true
    })
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
      return Promise.resolve(null)
    })
    autoUpdaterMock.quitAndInstall.mockImplementation(() => {
      lifecycle.push('native-quit-and-install')
      appMock.emit('will-quit', { preventDefault: vi.fn() })
    })
    killAllPtyMock.mockImplementation(() => lifecycle.push('in-process-pty-cleanup'))

    const { checkForUpdatesFromMenu, downloadUpdate, quitAndInstall, setupAutoUpdater } =
      await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never, {
      getLastUpdateCheckAt: () => Date.now(),
      installMode: 'supervised-headless-serve',
      onBeforeQuit: () => {
        lifecycle.push('pre-quit-checkpoint')
      }
    })
    checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    downloadUpdate()
    autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })
    const nativeReadyHandler = nativeUpdaterMock.on.mock.calls.find(
      ([event]) => event === 'update-downloaded'
    )?.[1] as (() => void) | undefined
    nativeReadyHandler?.()

    quitAndInstall()
    quitAndInstall()
    await vi.advanceTimersByTimeAsync(100)
    quitAndInstall()

    expect(requestServeUpdateHandoffMock).toHaveBeenCalledWith('1.0.61')
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(autoUpdaterMock.autoRunAppAfterInstall).toBe(false)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledOnce()
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledWith(true, false)
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce()
    expect(daemonSession).toEqual({ alive: true })
    expect(lifecycle).toEqual([
      'pre-quit-checkpoint',
      'handoff-persisted',
      'native-quit-and-install',
      'paired-clients-disconnected',
      'in-process-pty-cleanup'
    ])
  })

  it('clears leftover ShipIt state on macOS right before its deferred staging, not at download', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      const lifecycle: string[] = []
      prepareShipItStagingMock.mockImplementation(() => {
        lifecycle.push('shipit-staging-prepared')
        return Promise.resolve(true)
      })
      requestServeUpdateHandoffMock.mockImplementation(() => {
        lifecycle.push('handoff-persisted')
        return true
      })
      autoUpdaterMock.checkForUpdates.mockImplementation(() => {
        autoUpdaterMock.emit('checking-for-update')
        queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
        return Promise.resolve(null)
      })
      autoUpdaterMock.quitAndInstall.mockImplementation(() => {
        lifecycle.push('native-quit-and-install')
      })
      nativeUpdaterMock.checkForUpdates.mockImplementation(() =>
        lifecycle.push('native-staging-check')
      )
      const { checkForUpdatesFromMenu, downloadUpdate, quitAndInstall, setupAutoUpdater } =
        await loadUpdaterModule()
      setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
        getLastUpdateCheckAt: () => Date.now(),
        installMode: 'supervised-headless-serve'
      })
      checkForUpdatesFromMenu()
      await vi.advanceTimersByTimeAsync(0)
      downloadUpdate()
      expect(prepareShipItStagingMock).not.toHaveBeenCalled()
      autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })

      quitAndInstall()
      await vi.advanceTimersByTimeAsync(100)

      expect(lifecycle).toEqual([
        'handoff-persisted',
        'shipit-staging-prepared',
        'native-staging-check'
      ])
    } finally {
      if (platform) {
        Object.defineProperty(process, 'platform', platform)
      }
    }
  })

  it('keeps the serving owner intact when the supervisor handoff cannot be persisted', async () => {
    const send = vi.fn()
    requestServeUpdateHandoffMock.mockReturnValue(false)
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
      return Promise.resolve(null)
    })

    const { checkForUpdatesFromMenu, quitAndInstall, setupAutoUpdater } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never, {
      getLastUpdateCheckAt: () => Date.now(),
      installMode: 'supervised-headless-serve'
    })
    checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    ;(await import('./updater')).downloadUpdate()
    autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })
    const nativeReadyHandler = nativeUpdaterMock.on.mock.calls.find(
      ([event]) => event === 'update-downloaded'
    )?.[1] as (() => void) | undefined
    nativeReadyHandler?.()

    quitAndInstall()
    await vi.advanceTimersByTimeAsync(100)

    expect(requestServeUpdateHandoffMock).toHaveBeenCalledOnce()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    expect(killAllPtyMock).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'updater:status',
      expect.objectContaining({
        state: 'error',
        message: expect.stringContaining('supervised server restart')
      })
    )
  })

  describe('on macOS, where Squirrel stages the bundle only inside quitAndInstall', () => {
    const originalPlatform = process.platform

    beforeEach(() => {
      setPlatform('darwin')
    })

    afterEach(() => {
      setPlatform(originalPlatform)
    })

    const STAGED_INSTALL = [
      'install-committed',
      'in-process-pty-cleanup',
      'native-quit-and-install',
      'mac-updater-app-quit'
    ]

    // Models electron-updater's MacUpdater with autoInstallOnAppQuit off: each unstaged quitAndInstall adds a
    // persistent native listener that app.quit()s and only starts Squirrel; native errors are re-emitted first.
    const downloadSupervisedUpdate = async (
      lifecycle: string[],
      installMode: 'interactive' | 'supervised-headless-serve' = 'supervised-headless-serve'
    ) => {
      const send = vi.fn()
      autoUpdaterMock.checkForUpdates.mockImplementation(() => {
        autoUpdaterMock.emit('checking-for-update')
        queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
        return Promise.resolve(null)
      })
      let squirrelReady = false
      autoUpdaterMock.quitAndInstall.mockImplementation(() => {
        lifecycle.push('native-quit-and-install')
        const quit = () => {
          lifecycle.push('mac-updater-app-quit')
          appMock.quit()
        }
        if (squirrelReady) {
          quit()
        } else {
          nativeUpdaterMock.on('update-downloaded', quit)
        }
      })
      killAllPtyMock.mockImplementation(() => lifecycle.push('in-process-pty-cleanup'))
      armUpdateInstallExitWatchdogMock.mockImplementation(() => lifecycle.push('install-committed'))

      const { checkForUpdatesFromMenu, downloadUpdate, quitAndInstall, setupAutoUpdater } =
        await loadUpdaterModule()
      setupAutoUpdater(windowSending(send), {
        getLastUpdateCheckAt: () => Date.now(),
        installMode
      })
      checkForUpdatesFromMenu()
      await vi.advanceTimersByTimeAsync(0)
      downloadUpdate()
      await vi.advanceTimersByTimeAsync(0)
      autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })

      // Why: EventEmitter semantics — listeners run in registration order and a throw stops the rest.
      const emitNative = (event: string, ...args: unknown[]): void => {
        for (const [name, handler] of nativeUpdaterMock.on.mock.calls) {
          if (name === event && typeof handler === 'function') {
            handler(...args)
          }
        }
      }
      const squirrel = {
        staged: (): void => {
          squirrelReady = true
          emitNative('update-downloaded')
        },
        failed: (error: Error): void => {
          autoUpdaterMock.emit('error', error)
          emitNative('error', error)
        }
      }
      return { send, quitAndInstall, squirrel }
    }

    it.each(
      [false, undefined, null].flatMap((result) =>
        (['interactive', 'supervised-headless-serve'] as const).map((mode) => ({ result, mode }))
      )
    )('refuses $mode staging preparation result $result', async ({ result, mode }) => {
      const refuse = () =>
        prepareShipItStagingMock.mockReturnValue(
          result === null ? null : Promise.resolve(result as boolean)
        )
      if (mode === 'interactive') {
        refuse()
      }
      const { quitAndInstall, squirrel } = await downloadSupervisedUpdate([], mode)
      if (mode === 'supervised-headless-serve') {
        refuse()
        quitAndInstall()
        await vi.advanceTimersByTimeAsync(100)
      } else {
        expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
      }
      squirrel.staged()
      expect(nativeUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
      expectNoInstallerQuit()
      expect(killAllPtyMock).not.toHaveBeenCalled()
    })

    it('starts candidate-bound interactive staging without registering an early install listener', async () => {
      const lifecycle: string[] = []
      await downloadSupervisedUpdate(lifecycle, 'interactive')
      expect(nativeUpdaterMock.checkForUpdates).toHaveBeenCalledOnce()
      expectNoInstallerQuit()
    })

    it.each(['native failure', 'generation reset', 'candidate changed'])(
      'refuses late native readiness after %s',
      async (cause) => {
        const lifecycle: string[] = []
        const { quitAndInstall, squirrel } = await downloadSupervisedUpdate(lifecycle)
        if (cause === 'native failure') {
          nativeUpdaterMock.checkForUpdates.mockImplementation(() => {
            throw new Error('native staging failed')
          })
        }
        quitAndInstall()
        await vi.advanceTimersByTimeAsync(100)
        if (cause === 'generation reset') {
          ;(await import('./updater-mac-install')).resetMacInstallState()
        } else if (cause === 'candidate changed') {
          appMock.getVersion.mockReturnValue('9.0.0')
        } else {
          expect(failServeUpdateHandoffMock).toHaveBeenCalledOnce()
        }
        squirrel.staged()
        expect(lifecycle).toEqual([])
        expectNoInstallerQuit()
      }
    )

    it('reports the download installable and commits only once Squirrel stages it', async () => {
      const lifecycle: string[] = []
      const { send, quitAndInstall, squirrel } = await downloadSupervisedUpdate(lifecycle)

      expect(send).toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({ state: 'downloaded', version: '1.0.61' })
      )

      quitAndInstall()
      await vi.advanceTimersByTimeAsync(5_000)

      expect(requestServeUpdateHandoffMock).toHaveBeenCalledWith('1.0.61')
      expect(nativeUpdaterMock.checkForUpdates).toHaveBeenCalledOnce()
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
      expect(lifecycle).toEqual([])

      squirrel.staged()

      expect(lifecycle).toEqual(STAGED_INSTALL)
      expect(failServeUpdateHandoffMock).not.toHaveBeenCalled()
    })

    it('keeps the server intact and requires a restart after native staging loses its generation proof', async () => {
      const lifecycle: string[] = []
      const { send, quitAndInstall, squirrel } = await downloadSupervisedUpdate(lifecycle)
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(5_000)

      squirrel.failed(new Error('Code signature did not pass validation'))

      expect(failServeUpdateHandoffMock).toHaveBeenCalledOnce()
      expect(lifecycle).toEqual([])
      expect(send).toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({ state: 'error' })
      )

      quitAndInstall()
      await vi.advanceTimersByTimeAsync(100)
      expect(requestServeUpdateHandoffMock).toHaveBeenCalledTimes(1)
      expect(armUpdateInstallExitWatchdogMock).not.toHaveBeenCalled()
      expect(killAllPtyMock).not.toHaveBeenCalled()
      expect(lifecycle).toEqual([])
      const macInstall = await import('./updater-mac-install')
      expect(macInstall.hasMacStagingAuthority()).toBe(false)
      squirrel.staged()
      expect(appMock.quit).not.toHaveBeenCalled()
      expect(killAllPtyMock).not.toHaveBeenCalled()
      expect(lifecycle).toEqual([])
    })

    it('still commits and lets MacUpdater quit when session cleanup throws', async () => {
      const lifecycle: string[] = []
      const { quitAndInstall, squirrel } = await downloadSupervisedUpdate(lifecycle)
      killAllPtyMock.mockImplementation(() => {
        lifecycle.push('in-process-pty-cleanup')
        throw new Error('PTY cleanup callback failed')
      })
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(5_000)

      squirrel.staged()

      expect(lifecycle).toEqual(STAGED_INSTALL)
      expect(recordUpdaterLifecycleMock).toHaveBeenCalledWith(
        'post_commit_cleanup_failed',
        { errorType: 'Error' },
        expect.objectContaining({ level: 'warn' })
      )
    })

    it('does not abandon the staging for an unrelated updater error', async () => {
      const lifecycle: string[] = []
      const { quitAndInstall, squirrel } = await downloadSupervisedUpdate(lifecycle)
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(5_000)

      autoUpdaterMock.emit('error', new Error('Background update check failed'))
      squirrel.staged()

      expect(failServeUpdateHandoffMock).not.toHaveBeenCalled()
      expect(lifecycle).toEqual(STAGED_INSTALL)
    })

    it('reports a silent Squirrel but keeps the handoff live for a late staging', async () => {
      const lifecycle: string[] = []
      const { send, quitAndInstall, squirrel } = await downloadSupervisedUpdate(lifecycle)
      quitAndInstall()
      await vi.advanceTimersByTimeAsync(MAC_DEFERRED_STAGING_TIMEOUT_MS + 100)

      expect(send).toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({ state: 'error', version: '1.0.61', retryable: false })
      )
      expect(failServeUpdateHandoffMock).not.toHaveBeenCalled()
      expect(lifecycle).toEqual([])

      squirrel.staged()

      expect(lifecycle).toEqual(STAGED_INSTALL)
      expect(failServeUpdateHandoffMock).not.toHaveBeenCalled()
    })
  })

  it.runIf(process.platform === 'darwin')(
    'defers a pre-staged macOS update resumed from the native-ready continuation',
    async () => {
      const send = vi.fn()
      autoUpdaterMock.checkForUpdates.mockImplementation(() => {
        autoUpdaterMock.emit('checking-for-update')
        queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
        return Promise.resolve(null)
      })

      const { checkForUpdatesFromMenu, setupAutoUpdater } = await import('./updater')
      setupAutoUpdater({ webContents: { send } } as never, {
        getLastUpdateCheckAt: () => Date.now(),
        installMode: 'unsupported-headless-serve'
      })
      checkForUpdatesFromMenu()
      await vi.advanceTimersByTimeAsync(0)
      ;(await import('./updater')).downloadUpdate()
      autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })

      const { deferMacQuitUntilInstallerReady } = await import('./updater-mac-install')
      expect(
        deferMacQuitUntilInstallerReady(
          { state: 'downloading', percent: 100, version: '1.0.61' },
          true,
          () => '1.0.61',
          send
        )
      ).toBe(true)
      const nativeReadyHandler = nativeUpdaterMock.on.mock.calls.find(
        ([event]) => event === 'update-downloaded'
      )?.[1] as (() => void) | undefined
      nativeReadyHandler?.()
      await vi.advanceTimersByTimeAsync(0)

      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
      expect(killAllPtyMock).not.toHaveBeenCalled()
      expect(recordUpdaterLifecycleMock).toHaveBeenCalledWith(
        'headless_serve_install_deferred',
        { phase: 'install', version: '1.0.61' },
        expect.objectContaining({ level: 'warn' })
      )
      expect(send).toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({
          state: 'error',
          message: expect.stringContaining(`${PRIMARY_CLI_COMMAND} serve`)
        })
      )
    }
  )

  it.runIf(process.platform === 'darwin')(
    'does not reinterpret an ordinary headless app quit as an update install request',
    async () => {
      const send = vi.fn()
      autoUpdaterMock.checkForUpdates.mockImplementation(() => {
        autoUpdaterMock.emit('checking-for-update')
        queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
        return Promise.resolve(null)
      })

      const { checkForUpdatesFromMenu, setupAutoUpdater } = await import('./updater')
      setupAutoUpdater({ webContents: { send } } as never, {
        getLastUpdateCheckAt: () => Date.now(),
        installMode: 'unsupported-headless-serve'
      })
      checkForUpdatesFromMenu()
      await vi.advanceTimersByTimeAsync(0)
      ;(await import('./updater')).downloadUpdate()
      autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })

      const preventDefault = vi.fn()
      appMock.emit('before-quit', { preventDefault })
      await vi.advanceTimersByTimeAsync(15_000)

      expect(preventDefault).not.toHaveBeenCalled()
      expectNoInstallerQuit()
    }
  )

  it.runIf(process.platform === 'darwin')(
    'defers before the macOS installer-readiness timeout can quit the serving owner',
    async () => {
      const send = vi.fn()
      autoUpdaterMock.checkForUpdates.mockImplementation(() => {
        autoUpdaterMock.emit('checking-for-update')
        queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
        return Promise.resolve(null)
      })

      const { checkForUpdatesFromMenu, quitAndInstall, setupAutoUpdater } =
        await import('./updater')
      setupAutoUpdater({ webContents: { send } } as never, {
        getLastUpdateCheckAt: () => Date.now(),
        installMode: 'unsupported-headless-serve'
      })
      checkForUpdatesFromMenu()
      await vi.advanceTimersByTimeAsync(0)
      ;(await import('./updater')).downloadUpdate()
      autoUpdaterMock.emit('update-downloaded', { version: '1.0.61' })

      quitAndInstall()
      await vi.advanceTimersByTimeAsync(15_000)

      expectNoInstallerQuit()
      expect(killAllPtyMock).not.toHaveBeenCalled()
      expect(send).toHaveBeenCalledWith(
        'updater:status',
        expect.objectContaining({
          state: 'error',
          message: expect.stringContaining(`${PRIMARY_CLI_COMMAND} serve`)
        })
      )
    }
  )

  it('preserves interactive download with explicit install behavior', async () => {
    const send = vi.fn()
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      queueMicrotask(() => autoUpdaterMock.emit('update-available', { version: '1.0.61' }))
      return Promise.resolve(null)
    })

    const {
      checkForUpdatesFromMenu,
      downloadUpdate,
      getRemoteServerUpdateSupport,
      setupAutoUpdater
    } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never, {
      getLastUpdateCheckAt: () => Date.now(),
      installMode: 'interactive'
    })
    checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    downloadUpdate()

    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(autoUpdaterMock.autoRunAppAfterInstall).toBe(true)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(getRemoteServerUpdateSupport()).toEqual({
      installMode: 'interactive',
      automatic: true,
      reason: 'available'
    })
    expect(recordUpdaterLifecycleMock).not.toHaveBeenCalledWith(
      'headless_serve_install_deferred',
      expect.anything(),
      expect.anything()
    )
  })

  it('advertises remote update control only for safely restartable installs', async () => {
    const { checkForRemoteServerUpdate, getRemoteServerUpdateSupport, setupAutoUpdater } =
      await import('./updater')
    setupAutoUpdater({ webContents: { send: vi.fn() } } as never, {
      getLastUpdateCheckAt: () => Date.now(),
      installMode: 'unsupported-headless-serve'
    })

    expect(getRemoteServerUpdateSupport()).toEqual({
      installMode: 'unsupported-headless-serve',
      automatic: false,
      reason: 'manual-service-update-required'
    })
    expect(() => checkForRemoteServerUpdate('runtime-1')).toThrow('remote_update_manual_required')
  })
})

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}
