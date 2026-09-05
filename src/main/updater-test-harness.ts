import { afterAll, vi } from 'vitest'
import { applyProductBranding } from '../shared/brand'
import { createProductUpdaterTestMocks } from './updater-product-test-harness'
import type {
  AppMock,
  AutoUpdaterMock,
  UpdaterMocks,
  UpdaterModuleFactories
} from './updater-electron-test-types'
export type { ProductUpdateSource } from './updater-product-test-harness'
export type { UpdaterMocks } from './updater-electron-test-types'
import { clearTrackedRealTimers, trackRealTimers } from './updater-test-timer-tracking'
type LinuxPackageType = 'deb' | 'rpm' | 'non-root' | 'unusable'

// Why: macOS keeps the restart advice because quitting does re-stage a Squirrel update.
export const PRE_COMMIT_INSTALL_FAILURE =
  process.platform === 'darwin'
    ? applyProductBranding(
        'Could not restart to install the update. Quit and reopen Orca, then try again.'
      )
    : applyProductBranding('Could not start the update installer. Orca remains open.')

/**
 * Builds the electron/electron-updater mock graph `updater.ts` runs against, plus the module
 * factories each test file feeds to its own hoisted `vi.mock` calls. Call it from an awaited
 * `vi.hoisted` block so the mocks exist before the mock factories run.
 */
export function createUpdaterMocks(): UpdaterMocks {
  afterAll(() => {
    vi.useRealTimers()
    clearTrackedRealTimers()
  })
  const appEventHandlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const eventHandlers = new Map<string, ((...args: unknown[]) => void)[]>()

  const createHttpExecutorMock = () => ({
    request: vi.fn(),
    doApiRequest: vi.fn(),
    doDownload: vi.fn(),
    addRedirectHandlers: vi.fn()
  })

  const respondToProductUpdaterRequest = async (input: unknown): Promise<Response> => {
    const url = input instanceof URL ? input.href : String(input)
    if (url.includes('/hive/v1/updates/check')) {
      return new Response(
        JSON.stringify({
          hasUpdate: true,
          updateRequired: false,
          blockReason: null,
          currentBuild: 2,
          minimumSupportedBuild: 1,
          latest: null
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    }
    return new Response('version: 1.0.61\n')
  }
  const productUpdaterSessionFetchMock = vi.fn(respondToProductUpdaterRequest)

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
    autoUpdaterMock.checkForUpdates.mockReset().mockResolvedValue(null)
    autoUpdaterMock.downloadUpdate.mockReset()
    autoUpdaterMock.quitAndInstall.mockReset()
    autoUpdaterMock.setFeedURL.mockClear()
    autoUpdaterMock.updateConfigPath = undefined
    autoUpdaterMock.allowPrerelease = false
    autoUpdaterMock.allowDowngrade = false
    autoUpdaterMock.disableDifferentialDownload = false
    autoUpdaterMock.autoRunAppAfterInstall = true
    autoUpdaterMock.logger = undefined
    // The production network boundary replaces these methods with guarded
    // implementations. Recreate the executor between tests instead of
    // trying to reset functions that may no longer be Vitest mocks.
    autoUpdaterMock.httpExecutor = createHttpExecutorMock()
    delete (autoUpdaterMock as Record<string, unknown>).verifyUpdateCodeSignature
  }

  const autoUpdaterMock: AutoUpdaterMock = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: true,
    allowPrerelease: false,
    allowDowngrade: false,
    disableDifferentialDownload: false,
    // Why: setup installs the diagnostic logger adapter here; tests drive child stderr through it.
    logger: undefined as { error: (message: unknown) => void } | undefined,
    httpExecutor: createHttpExecutorMock(),
    on,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
    updateConfigPath: undefined as string | undefined,
    emit,
    reset
  }

  const appMock: AppMock = {
    isPackaged: true,
    getVersion: vi.fn(() => '1.0.51'),
    on: appOn,
    emit: appEmit,
    quit: vi.fn()
  }
  const browserWindowMock = {
    getAllWindows: vi.fn(() => [])
  }
  const nativeUpdaterMock = {
    on: vi.fn()
  }
  const isMock = { dev: false }
  const killAllPtyMock = vi.fn()
  const powerMonitorOnMock = vi.fn()
  const getLinuxRootPackageTypeMock = vi.fn<() => 'deb' | 'rpm' | null>(() => null)
  const getLinuxPackageTypeMock = vi.fn<() => LinuxPackageType>(() => {
    return getLinuxRootPackageTypeMock() ?? 'non-root'
  })
  const isExternallyManagedLinuxInstallMock = vi.fn<() => boolean>(() => false)
  const recordUpdaterLifecycleMock = vi.fn()
  const fetchChangelogMock = vi.fn()
  const fetchNudgeMock = vi.fn()
  const shouldApplyNudgeMock = vi.fn()
  const armExitWatchdogMock = vi.fn()
  const disarmExitWatchdogMock = vi.fn()
  const fetchNewerReleaseTagsMock = vi.fn()
  const chooseLocalBuildMock = vi.fn()
  const startLocalBuildFeedMock = vi.fn()
  const closeLocalBuildFeedMock = vi.fn()
  const { productUpdaterModuleFactories, resetProductUpdaterMocks, ...productUpdaterTestState } =
    createProductUpdaterTestMocks()
  const { productUpdateSourceState } = productUpdaterTestState

  /** One factory per module `updater.ts` pulls in; test files pass these to their own `vi.mock`. */
  const moduleFactories: UpdaterModuleFactories = {
    electron: () => ({
      app: appMock,
      BrowserWindow: browserWindowMock,
      autoUpdater: nativeUpdaterMock,
      session: {
        fromPartition: vi.fn(() => ({
          fetch: productUpdaterSessionFetchMock,
          webRequest: {
            onBeforeRequest: vi.fn(),
            onHeadersReceived: vi.fn()
          }
        }))
      },
      powerMonitor: { on: powerMonitorOnMock },
      shell: { showItemInFolder: vi.fn() },
      net: { fetch: vi.fn() }
    }),
    electronUpdater: () => ({ autoUpdater: autoUpdaterMock }),
    electronUpdaterLoader: () => ({ loadElectronAutoUpdater: () => autoUpdaterMock }),
    electronToolkitUtils: () => ({ is: isMock }),
    ipcPty: () => ({ killAllPty: killAllPtyMock }),
    // Why: only the marker resolver is faked so the real artifact capture/redaction path stays under test.
    linuxUpdatePackageType: () => ({
      getLinuxPackageType: getLinuxPackageTypeMock,
      getLinuxRootPackageType: getLinuxRootPackageTypeMock,
      isExternallyManagedLinuxInstall: isExternallyManagedLinuxInstallMock
    }),
    updaterLifecycleDiagnostics: () => ({ recordUpdaterLifecycle: recordUpdaterLifecycleMock }),
    updaterChangelog: () => ({ fetchChangelog: fetchChangelogMock }),
    updaterNudge: () => ({ fetchNudge: fetchNudgeMock, shouldApplyNudge: shouldApplyNudgeMock }),
    updateInstallExitWatchdog: () => ({
      armUpdateInstallExitWatchdog: armExitWatchdogMock,
      disarmUpdateInstallExitWatchdog: disarmExitWatchdogMock
    }),
    updaterPrereleaseFeed: () => ({
      fetchNewerReleaseTagsWithReadiness: async (...args: unknown[]) => {
        const result = (await fetchNewerReleaseTagsMock(...args)) as
          | unknown[]
          | { state?: string; currentTag?: string }
        const currentVersion = typeof args[0] === 'string' ? args[0] : null
        const options = args[2] as
          | { includePrerelease?: boolean; releaseFilter?: string }
          | undefined
        const currentMatchesFilter =
          currentVersion !== null &&
          (options?.releaseFilter === 'perf'
            ? currentVersion.includes('.perf')
            : options?.includePrerelease || !currentVersion.includes('-'))
        const noNewerResult = currentMatchesFilter
          ? { tags: [], state: 'no-newer', currentTag: `v${currentVersion}` }
          : { tags: [], state: 'no-newer' }
        return Array.isArray(result)
          ? result.length > 0
            ? { tags: result, state: 'ready' }
            : noNewerResult
          : result?.state === 'no-newer' && !result.currentTag
            ? { ...result, ...noNewerResult }
            : result
      },
      getReleaseDownloadUrl: (tag: string) => {
        const github = productUpdateSourceState.value?.github
        return github ? `${github.releasesDownloadBase}/${tag}` : null
      }
    }),
    localBuildSwitch: () => ({ chooseLocalBuild: chooseLocalBuildMock }),
    localBuildFeedServer: () => ({ startLocalBuildFeed: startLocalBuildFeedMock }),
    ...productUpdaterModuleFactories
  }

  /** Shared `beforeEach` body: fresh module registry plus every mock back to its default. */
  const resetUpdaterMocks = () => {
    vi.clearAllTimers()
    clearTrackedRealTimers()
    vi.resetModules()
    autoUpdaterMock.reset()
    productUpdaterSessionFetchMock.mockReset().mockImplementation(respondToProductUpdaterRequest)
    nativeUpdaterMock.on.mockReset()
    browserWindowMock.getAllWindows.mockReset()
    browserWindowMock.getAllWindows.mockReturnValue([])
    appMock.getVersion.mockReset()
    appMock.getVersion.mockReturnValue('1.0.51')
    appMock.quit.mockReset()
    appMock.isPackaged = true
    resetProductUpdaterMocks()
    isMock.dev = false
    killAllPtyMock.mockReset()
    armExitWatchdogMock.mockReset()
    disarmExitWatchdogMock.mockReset()
    powerMonitorOnMock.mockReset()
    getLinuxRootPackageTypeMock.mockReset().mockReturnValue(null)
    getLinuxPackageTypeMock.mockReset().mockImplementation(() => {
      return getLinuxRootPackageTypeMock() ?? 'non-root'
    })
    isExternallyManagedLinuxInstallMock.mockReset().mockReturnValue(false)
    recordUpdaterLifecycleMock.mockReset()
    fetchNudgeMock.mockReset().mockResolvedValue(null)
    shouldApplyNudgeMock.mockReset().mockReturnValue(false)
    fetchChangelogMock.mockReset().mockResolvedValue(null)
    fetchNewerReleaseTagsMock.mockReset().mockResolvedValue([])
    chooseLocalBuildMock.mockReset()
    closeLocalBuildFeedMock.mockReset()
    startLocalBuildFeedMock.mockReset().mockResolvedValue({
      url: 'http://127.0.0.1:1234/token/',
      close: closeLocalBuildFeedMock
    })
    vi.unstubAllGlobals()
    vi.useRealTimers()
    trackRealTimers()
  }

  return {
    appMock,
    browserWindowMock,
    nativeUpdaterMock,
    autoUpdaterMock,
    isMock,
    killAllPtyMock,
    powerMonitorOnMock,
    getLinuxPackageTypeMock,
    getLinuxRootPackageTypeMock,
    isExternallyManagedLinuxInstallMock,
    recordUpdaterLifecycleMock,
    fetchChangelogMock,
    fetchNudgeMock,
    shouldApplyNudgeMock,
    armExitWatchdogMock,
    disarmExitWatchdogMock,
    fetchNewerReleaseTagsMock,
    chooseLocalBuildMock,
    startLocalBuildFeedMock,
    closeLocalBuildFeedMock,
    ...productUpdaterTestState,
    moduleFactories,
    resetUpdaterMocks
  }
}
