import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ login: vi.fn(), write: vi.fn(), remove: vi.fn() }))
vi.mock('./claude-login-session', () => ({ runClaudeLoginSession: mocks.login }))
vi.mock('./claude-managed-auth-storage', () => ({
  ClaudeManagedAuthStorage: class {
    async create(id: string) {
      return {
        managedAuthPath: `/owned/${id}/auth`,
        managedAuthRuntime: 'host',
        wslDistro: null,
        wslLinuxAuthPath: null
      }
    }
    writeAuth = mocks.write
    remove = mocks.remove
  }
}))
import { ClaudeAccountService } from './service'
import { getDefaultSettings } from '../../shared/constants'
const captured = {
  credentialsJson: 'synthetic',
  oauthAccount: {},
  identity: { email: 'a@example.test', organizationUuid: null, organizationName: null }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.write.mockResolvedValue(undefined)
  mocks.remove.mockResolvedValue(undefined)
})
function fixture() {
  let settings = getDefaultSettings('/test')
  const update = vi.fn((patch) => {
    settings = { ...settings, ...patch }
  })
  const service = new ClaudeAccountService(
    { getSettings: () => settings, updateSettings: update } as never,
    {
      evictInactiveClaudeCache: vi.fn(),
      refreshForClaudeAccountChange: vi.fn().mockResolvedValue(undefined)
    } as never,
    {
      clearLastWrittenCredentialsJson: vi.fn(),
      forceMaterializeCurrentSelectionForRollback: vi.fn().mockResolvedValue(undefined)
    } as never
  )
  return { service, update, settings: () => settings }
}
describe('captured Claude account sign-in', () => {
  it('publishes copied link before completion and commits only captured credentials', async () => {
    const f = fixture(),
      finish = Promise.withResolvers<typeof captured>()
    mocks.login.mockImplementation((_location, _deps, publish) => {
      publish('https://claude.ai/test-link')
      return finish.promise
    })
    const adding = f.service.addAccount(undefined, true)
    expect(await f.service.waitForSignInLink()).toBe('https://claude.ai/test-link')
    expect(f.settings().claudeManagedAccounts).toEqual([])
    finish.resolve(captured)
    await adding
    expect(mocks.write).toHaveBeenCalledOnce()
    expect(f.update).toHaveBeenCalledWith(
      expect.objectContaining({ claudeManagedAccounts: expect.any(Array) }),
      { notifyListeners: true }
    )
    expect(await f.service.waitForSignInLink()).toBeNull()
  })
  it('settles copied-link waiters on failure without publishing an account', async () => {
    const f = fixture()
    mocks.login.mockRejectedValue(new Error('login cancelled'))
    const adding = f.service.addAccount(undefined, true),
      link = f.service.waitForSignInLink()
    await expect(adding).rejects.toThrow('login cancelled')
    expect(await link).toBeNull()
    expect(mocks.write).not.toHaveBeenCalled()
    expect(f.settings().claudeManagedAccounts).toEqual([])
  })
})
