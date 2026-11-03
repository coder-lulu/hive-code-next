import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeTerminalSignIn } from './claude-terminal-sign-in'
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  drop: vi.fn(),
  write: vi.fn()
}))
vi.mock('./claude-login-session', () => ({
  createTemporaryClaudeConfigDir: mocks.create,
  removeTemporaryClaudeConfigDir: mocks.remove
}))
vi.mock('./keychain', () => ({
  readActiveClaudeKeychainCredentialsStrict: mocks.read,
  deleteActiveClaudeKeychainCredentialsStrict: mocks.drop,
  writeActiveClaudeKeychainCredentials: mocks.write
}))
const captured = {
  credentialsJson: '{"claudeAiOauth":{"accessToken":"test"}}',
  oauthAccount: {},
  identity: { email: 'a@example.test', organizationUuid: null, organizationName: null }
}
const folder = { windowsPath: '/owned-temp', linuxPath: null, wslDistro: null }
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  mocks.create.mockResolvedValue(folder)
  mocks.remove.mockResolvedValue(undefined)
  mocks.read.mockResolvedValue(null)
})
afterEach(() => vi.useRealTimers())
describe('host-owned temporary Claude sign-in', () => {
  it('commits captured credentials using server-owned path and never accepts a caller folder', async () => {
    const owner = new ClaudeTerminalSignIn(() => ({ runtime: 'host' }))
    const begun = await owner.begin({})
    const capture = vi.fn().mockResolvedValue(captured),
      commit = vi.fn().mockResolvedValue('saved')
    expect(await owner.finish(begun, capture, commit)).toBe('saved')
    expect(capture).toHaveBeenCalledWith(folder, null)
    expect(commit).toHaveBeenCalledWith(
      captured,
      { runtime: 'host', wslDistro: null },
      undefined,
      begun.accountId
    )
    expect(mocks.remove).toHaveBeenCalledWith(folder)
    await expect(owner.finish(begun, capture, commit)).rejects.toThrow('expired')
    expect(commit).toHaveBeenCalledTimes(1)
  })
  it('uses an opaque attempt id for reauthentication and rejects forged runtime scope', async () => {
    const owner = new ClaudeTerminalSignIn(() => ({ runtime: 'host' }))
    const begun = await owner.begin({ accountId: 'existing' })
    expect(begun.accountId).not.toBe('existing')
    const commit = vi.fn()
    await expect(
      owner.finish({ ...begun, runtime: 'wsl', wslDistro: 'Ubuntu' }, vi.fn(), commit)
    ).rejects.toThrow('another runtime')
    expect(commit).not.toHaveBeenCalled()
    await owner.cancel(begun)
  })
  it('expires abandoned attempts, removes temporary credentials and fences delayed capture', async () => {
    const owner = new ClaudeTerminalSignIn(() => ({ runtime: 'host' }))
    const begun = await owner.begin({})
    const delayed = Promise.withResolvers<typeof captured>(),
      commit = vi.fn()
    const finishing = owner.finish(begun, () => delayed.promise, commit)
    const rejected = expect(finishing).rejects.toThrow('expired')
    await vi.advanceTimersByTimeAsync(600_000)
    delayed.resolve(captured)
    await rejected
    expect(commit).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledWith(folder)
  })
  it('refuses overlapping logins and cleans temporary data after commit failure', async () => {
    const owner = new ClaudeTerminalSignIn(() => ({ runtime: 'host' }))
    const begun = await owner.begin({})
    await expect(owner.begin({})).rejects.toThrow('Finish or cancel')
    await expect(
      owner.finish(
        begun,
        async () => captured,
        async () => {
          throw new Error('persist denied')
        }
      )
    ).rejects.toThrow('persist denied')
    expect(mocks.remove).toHaveBeenCalledWith(folder)
  })
})
