import type { Mock } from 'vitest'
import type {
  ProductUpdaterModuleFactories,
  ProductUpdaterTestState
} from './updater-product-test-harness'

type UpdaterSpy = Mock<(...args: unknown[]) => unknown>

export type AutoUpdaterMock = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  autoRunAppAfterInstall: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  disableDifferentialDownload: boolean
  logger: { error: (message: unknown) => void } | undefined
  httpExecutor: {
    request: UpdaterSpy
    doApiRequest: UpdaterSpy
    doDownload: UpdaterSpy
    addRedirectHandlers: UpdaterSpy
  }
  on: Mock<(event: string, handler: (...args: unknown[]) => void) => AutoUpdaterMock>
  checkForUpdates: UpdaterSpy
  downloadUpdate: UpdaterSpy
  quitAndInstall: UpdaterSpy
  setFeedURL: UpdaterSpy
  updateConfigPath: string | undefined
  emit: (event: string, ...args: unknown[]) => void
  reset: () => void
}

export type AppMock = {
  isPackaged: boolean
  getVersion: Mock<() => string>
  on: Mock<(event: string, handler: (...args: unknown[]) => void) => AppMock>
  emit: (event: string, ...args: unknown[]) => void
  quit: UpdaterSpy
}

export type UpdaterModuleFactories = {
  electron: () => {
    app: AppMock
    BrowserWindow: { getAllWindows: Mock<() => unknown[]> }
    autoUpdater: { on: UpdaterSpy }
    session: {
      fromPartition: Mock<
        () => {
          fetch: UpdaterSpy
          webRequest: {
            onBeforeRequest: UpdaterSpy
            onHeadersReceived: UpdaterSpy
          }
        }
      >
    }
    powerMonitor: { on: UpdaterSpy }
    shell: { showItemInFolder: UpdaterSpy }
    net: { fetch: UpdaterSpy }
  }
  electronUpdater: () => { autoUpdater: AutoUpdaterMock }
  electronUpdaterLoader: () => { loadElectronAutoUpdater: () => AutoUpdaterMock }
  electronToolkitUtils: () => { is: { dev: boolean } }
  ipcPty: () => { killAllPty: UpdaterSpy }
  linuxUpdatePackageType: () => { getLinuxRootPackageType: Mock<() => 'deb' | 'rpm' | null> }
  updaterLifecycleDiagnostics: () => { recordUpdaterLifecycle: UpdaterSpy }
  updaterChangelog: () => { fetchChangelog: UpdaterSpy }
  updaterNudge: () => { fetchNudge: UpdaterSpy; shouldApplyNudge: UpdaterSpy }
  updateInstallExitWatchdog: () => {
    armUpdateInstallExitWatchdog: UpdaterSpy
    disarmUpdateInstallExitWatchdog: UpdaterSpy
  }
  updaterPrereleaseFeed: () => {
    fetchNewerReleaseTagsWithReadiness: (...args: unknown[]) => Promise<unknown>
    getReleaseDownloadUrl: (tag: string) => string | null
  }
  localBuildSwitch: () => { chooseLocalBuild: UpdaterSpy }
  localBuildFeedServer: () => { startLocalBuildFeed: UpdaterSpy }
} & ProductUpdaterModuleFactories

export type UpdaterMocks = {
  appMock: AppMock
  browserWindowMock: { getAllWindows: Mock<() => unknown[]> }
  nativeUpdaterMock: { on: UpdaterSpy }
  autoUpdaterMock: AutoUpdaterMock
  isMock: { dev: boolean }
  killAllPtyMock: UpdaterSpy
  powerMonitorOnMock: UpdaterSpy
  getLinuxRootPackageTypeMock: Mock<() => 'deb' | 'rpm' | null>
  recordUpdaterLifecycleMock: UpdaterSpy
  fetchChangelogMock: UpdaterSpy
  fetchNudgeMock: UpdaterSpy
  shouldApplyNudgeMock: UpdaterSpy
  armExitWatchdogMock: UpdaterSpy
  disarmExitWatchdogMock: UpdaterSpy
  fetchNewerReleaseTagsMock: UpdaterSpy
  chooseLocalBuildMock: UpdaterSpy
  startLocalBuildFeedMock: UpdaterSpy
  closeLocalBuildFeedMock: UpdaterSpy
  moduleFactories: UpdaterModuleFactories
  resetUpdaterMocks: () => void
} & ProductUpdaterTestState
