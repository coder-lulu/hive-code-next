import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ sync: vi.fn(), running: vi.fn(), prepare: vi.fn() }))
vi.mock('./runtime-auth/runtime-auth-sync', () => ({
  ClaudeRuntimeAuthSync: class {
    mutationQueue = Promise.resolve()
    store: unknown
    constructor(store: unknown) {
      this.store = store
    }
    getDefaultAccountSelectionTarget() {
      return { runtime: 'host' }
    }
    resolveWslDefaultTarget(target: unknown) {
      return target
    }
    doSyncForCurrentSelection = mocks.sync
    getPreparation = mocks.prepare
  }
}))
vi.mock('../wsl-background-distro-gate', () => ({ isWslDistroRunning: mocks.running }))
import { ClaudeRuntimeAuthService } from './runtime-auth-service'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.sync.mockResolvedValue(undefined)
  mocks.running.mockResolvedValue(false)
  mocks.prepare.mockReturnValue({
    configDir: '/owned',
    envPatch: {},
    stripAuthEnv: true,
    provenance: 'managed:test'
  })
})
function service() {
  return new ClaudeRuntimeAuthService({
    getSettings: () => ({ activeClaudeManagedAccountId: null })
  } as never)
}
describe('captured runtime auth owner', () => {
  it('does not boot a stopped WSL distro for background usage', async () => {
    const owner = service()
    await owner.syncForCurrentSelection()
    mocks.sync.mockClear()
    expect(
      await owner.prepareForRateLimitFetch({ runtime: 'wsl', wslDistro: 'Ubuntu' })
    ).toMatchObject({ usageError: 'WSL distro Ubuntu is not running.' })
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('uses verified sync for explicit launch', async () => {
    const owner = service()
    const target = { runtime: 'wsl' as const, wslDistro: 'Ubuntu' }
    await owner.prepareForClaudeLaunch(target)
    expect(mocks.sync).toHaveBeenLastCalledWith(target)
    expect(mocks.running).not.toHaveBeenCalled()
  })
  it('reports usage failure while launch failure remains explicit', async () => {
    const owner = service()
    await owner.syncForCurrentSelection()
    mocks.sync.mockRejectedValue(new Error('readback unavailable'))
    expect(await owner.prepareForRateLimitFetch()).toMatchObject({
      usageError: 'readback unavailable'
    })
    await expect(owner.prepareForClaudeLaunch()).rejects.toThrow('readback unavailable')
  })
})
