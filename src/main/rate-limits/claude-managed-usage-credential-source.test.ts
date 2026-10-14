import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn(), fetch: vi.fn(), running: vi.fn() }))
vi.mock('../claude-accounts/claude-managed-auth-storage', () => ({
  ClaudeManagedAuthStorage: class {
    readSnapshot = mocks.read
  }
}))
vi.mock('../claude-accounts/oauth-refresh', () => ({ isOauthTokenExpiring: () => false }))
vi.mock('../wsl-background-distro-gate', () => ({ isWslDistroRunning: mocks.running }))
vi.mock('./claude-oauth-usage-request', () => ({ fetchClaudeOAuthUsage: mocks.fetch }))
import { fetchInactiveClaudeAccountUsage } from './claude-managed-account-usage'
import { OAuthUsageError } from './claude-oauth-usage-error'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.running.mockResolvedValue(true)
  mocks.read.mockResolvedValue({ credentialsJson: '{"claudeAiOauth":{"accessToken":"synthetic"}}' })
})
it('preserves upstream 429 retry metadata on the captured credential owner', async () => {
  mocks.fetch.mockRejectedValue(new OAuthUsageError('Synthetic wait', 429, true, 3600000))
  const started = Date.now()
  const result = await fetchInactiveClaudeAccountUsage({
    id: 'A',
    managedAuthPath: '/owned/A/auth',
    managedAuthRuntime: 'host'
  })
  expect(result.usageMetadata).toMatchObject({
    failureKind: 'rate-limited',
    attemptedSources: ['oauth']
  })
  expect(result.usageMetadata?.retryAtMs).toBeGreaterThanOrEqual(started + 3600000)
  expect(mocks.read).toHaveBeenCalledWith('A', '/owned/A/auth')
  expect(mocks.fetch).toHaveBeenCalledWith('synthetic', undefined)
})
it('does not touch a stopped WSL distro credential path', async () => {
  mocks.running.mockResolvedValue(false)
  await fetchInactiveClaudeAccountUsage({
    id: 'A',
    managedAuthPath: '/owned/A/auth',
    managedAuthRuntime: 'wsl',
    wslDistro: 'Ubuntu'
  })
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.fetch).not.toHaveBeenCalled()
})
