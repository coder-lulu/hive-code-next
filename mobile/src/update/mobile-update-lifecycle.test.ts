import { beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  appState: { currentState: 'active' },
  permission: vi.fn(),
  hasPermission: vi.fn(),
  download: vi.fn(),
  open: vi.fn(),
  subscribe: vi.fn(),
  remove: vi.fn()
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => deps.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      deps.storage.set(key, value)
    }
  }
}))
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: { version: '1.5.0-beta.8', android: { versionCode: 26 } }
  }
}))
vi.mock('react-native', () => ({
  AppState: deps.appState,
  Platform: { OS: 'android', constants: { Architecture: 'arm64-v8a' } },
  Linking: {}
}))
vi.mock('@hivecode/expo-hivecode-updater', () => ({
  requestApkInstallPermission: deps.permission,
  hasApkInstallPermission: deps.hasPermission,
  downloadVerifiedApk: deps.download,
  openApkInstaller: deps.open,
  subscribeApkDownloadProgress: deps.subscribe
}))

const artifact = {
  packageFormat: 'apk',
  distributionType: 'direct',
  downloadUrl:
    'https://releases.hivekernel.com/hive/v1/update-artifacts/f2c6be7e-1d21-4fa4-b0e5-a9b50066f4dc/download',
  storeUrl: null,
  sha256: 'a'.repeat(64),
  size: 100
}
function available(mandatory = false) {
  return async () =>
    new Response(
      JSON.stringify({
        hasUpdate: true,
        updateRequired: mandatory,
        currentBuild: 26,
        minimumSupportedBuild: mandatory ? 27 : null,
        latest: {
          versionName: '1.5.0-beta.9',
          buildNumber: 27,
          mandatory,
          releaseNotes: 'Fixes',
          artifact
        }
      })
    )
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const load = () => import('./mobile-update-service')

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  deps.storage.clear()
  deps.appState.currentState = 'active'
  deps.permission.mockResolvedValue(true)
  deps.hasPermission.mockResolvedValue(true)
  deps.download.mockResolvedValue('content://hivecode/update.apk')
  deps.open.mockResolvedValue(undefined)
  deps.subscribe.mockReturnValue(deps.remove)
})

describe('mobile update lifecycle', () => {
  it('requests the universal APK independently of the device ABI', async () => {
    const service = await load()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).searchParams.get('architecture')).toBe('universal')
      return available()()
    })
    await service.checkMobileUpdate({ force: true, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it.each(['ready', 'permission'])(
    'allows an explicit recheck while waiting for %s',
    async (stage) => {
      const service = await load()
      await service.checkMobileUpdate({ force: true, fetchImpl: available() })
      if (stage === 'permission') {
        deps.permission.mockResolvedValueOnce(false)
      }
      await service.downloadAndInstallAndroidUpdate()
      const fetchImpl = vi.fn(available(true))
      expect(await service.checkMobileUpdate({ force: true, fetchImpl })).toMatchObject({
        state: 'available',
        mandatory: true
      })
      expect(fetchImpl).toHaveBeenCalledOnce()
    }
  )

  it('does not resume permission-pending updates after choosing later', async () => {
    const service = await load()
    await service.checkMobileUpdate({ force: true, fetchImpl: available() })
    deps.permission.mockResolvedValueOnce(false)
    await service.downloadAndInstallAndroidUpdate()
    service.dismissMobileUpdatePrompt()
    await service.resumeMobileUpdate()
    expect(deps.download).not.toHaveBeenCalled()
    expect(service.getMobileUpdateSnapshot().promptVisible).toBe(false)
  })

  it('keeps a background download ready until the user opens the installer', async () => {
    const service = await load()
    await service.checkMobileUpdate({ force: true, fetchImpl: available() })
    deps.appState.currentState = 'background'
    expect(await service.downloadAndInstallAndroidUpdate()).toMatchObject({
      state: 'ready-to-install'
    })
    expect(deps.open).not.toHaveBeenCalled()
    deps.appState.currentState = 'active'
    await service.downloadAndInstallAndroidUpdate()
    expect(deps.download).toHaveBeenCalledOnce()
    expect(deps.open).toHaveBeenCalledOnce()
  })

  it('shows the install prompt again after a background download completes', async () => {
    const service = await load()
    await service.checkMobileUpdate({ force: true, fetchImpl: available() })
    deps.appState.currentState = 'background'
    await service.downloadAndInstallAndroidUpdate()
    expect(service.getMobileUpdateSnapshot()).toMatchObject({
      state: 'ready-to-install',
      promptVisible: true,
      downloadedBytes: artifact.size
    })
    expect(deps.open).not.toHaveBeenCalled()
  })

  it('prompts for an ordinary update without starting a download', async () => {
    const service = await load()
    const result = await service.checkMobileUpdate({
      force: true,
      fetchImpl: available()
    })
    expect(result).toMatchObject({
      state: 'available',
      promptVisible: true,
      mandatory: false
    })
    expect(deps.download).not.toHaveBeenCalled()
    service.dismissMobileUpdatePrompt()
    await service.resumeMobileUpdate()
    expect(service.getMobileUpdateSnapshot().promptVisible).toBe(false)
    service.showMobileUpdatePrompt()
    expect(service.getMobileUpdateSnapshot().promptVisible).toBe(true)
  })

  it('restores an ordinary update after restart even inside the check interval', async () => {
    let service = await load()
    await service.checkMobileUpdate({ force: true, fetchImpl: available() })
    vi.resetModules()
    service = await load()
    const fetchImpl = vi.fn()
    expect(await service.checkMobileUpdate({ fetchImpl })).toMatchObject({
      state: 'available',
      promptVisible: true,
      buildNumber: 27
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not let a foreground check replace or duplicate an active download', async () => {
    const service = await load()
    await service.checkMobileUpdate({
      force: true,
      fetchImpl: available(true)
    })
    const pending = deferred<string>()
    deps.download.mockReturnValue(pending.promise)
    const first = service.downloadAndInstallAndroidUpdate()
    await vi.waitFor(() => expect(deps.download).toHaveBeenCalledOnce())
    expect(await service.resumeMobileUpdate()).toMatchObject({
      state: 'downloading',
      mandatory: true
    })
    await service.checkMobileUpdate({ force: true, fetchImpl: vi.fn() })
    expect(service.downloadAndInstallAndroidUpdate()).toBe(first)
    expect(deps.download).toHaveBeenCalledOnce()
    pending.resolve('content://hivecode/update.apk')
    await first
    expect(deps.open).toHaveBeenCalledOnce()
  })

  it('publishes bounded progress for the selected artifact and removes its listener', async () => {
    const service = await load()
    await service.checkMobileUpdate({ force: true, fetchImpl: available() })
    const pending = deferred<string>()
    deps.download.mockReturnValue(pending.promise)
    const install = service.downloadAndInstallAndroidUpdate()
    await vi.waitFor(() => expect(deps.subscribe).toHaveBeenCalledOnce())
    const progress = deps.subscribe.mock.calls[0][0]
    progress({ sha256: artifact.sha256, downloadedBytes: 35, totalBytes: 100 })
    expect(service.getMobileUpdateSnapshot().downloadedBytes).toBe(35)
    progress({ sha256: 'other', downloadedBytes: 90, totalBytes: 100 })
    progress({ sha256: artifact.sha256, downloadedBytes: 12, totalBytes: 100 })
    expect(service.getMobileUpdateSnapshot().downloadedBytes).toBe(35)
    progress({
      sha256: artifact.sha256,
      downloadedBytes: 200,
      totalBytes: 100
    })
    expect(service.getMobileUpdateSnapshot().downloadedBytes).toBe(100)
    pending.resolve('content://hivecode/update.apk')
    await install
    expect(deps.remove).toHaveBeenCalledOnce()
  })

  it('reopens the installer without downloading again or claiming installation succeeded', async () => {
    const service = await load()
    await service.checkMobileUpdate({ force: true, fetchImpl: available() })
    await service.downloadAndInstallAndroidUpdate()
    await service.resumeMobileUpdate()
    await service.downloadAndInstallAndroidUpdate()
    expect(deps.download).toHaveBeenCalledOnce()
    expect(deps.open).toHaveBeenCalledTimes(2)
    expect(service.getMobileUpdateSnapshot().state).toBe('ready-to-install')
  })

  it('waits for permission and resumes on foreground without reopening settings on denial', async () => {
    const service = await load()
    await service.checkMobileUpdate({ force: true, fetchImpl: available() })
    deps.permission.mockResolvedValueOnce(false)
    expect(await service.downloadAndInstallAndroidUpdate()).toMatchObject({
      state: 'awaiting-permission'
    })
    expect(deps.download).not.toHaveBeenCalled()
    deps.hasPermission.mockResolvedValueOnce(false)
    await service.resumeMobileUpdate()
    expect(deps.permission).toHaveBeenCalledOnce()
    expect(await service.resumeMobileUpdate()).toMatchObject({
      state: 'ready-to-install'
    })
    expect(deps.download).toHaveBeenCalledOnce()
  })

  it('preserves a mandatory prompt during recheck and does not allow dismissal', async () => {
    const service = await load()
    await service.checkMobileUpdate({
      force: true,
      fetchImpl: available(true)
    })
    service.dismissMobileUpdatePrompt()
    const pending = deferred<Response>()
    const checking = service.checkMobileUpdate({
      force: true,
      fetchImpl: () => pending.promise
    })
    expect(service.getMobileUpdateSnapshot()).toMatchObject({
      state: 'checking',
      mandatory: true,
      promptVisible: true
    })
    pending.resolve(await available(true)())
    await checking
  })
})
