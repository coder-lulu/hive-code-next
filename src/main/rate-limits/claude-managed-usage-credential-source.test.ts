import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  wslPrepare: vi.fn(),
  fetch: vi.fn(),
  blocked: vi.fn()
}))
vi.mock('../claude-accounts/claude-profile-installed-router', () => ({
  getClaudeProfileRouter: () => ({ accountUsagePreparation: mocks.prepare }),
  getClaudeWslProfileRouter: () => ({ accountUsagePreparation: mocks.wslPrepare })
}))
vi.mock('../claude-accounts/keychain', () => ({
  readActiveClaudeKeychainCredentialsStrict: vi.fn(async () => null)
}))
vi.mock('../wsl/wsl-unc-access-gate', () => ({ blockedWslDistroForPath: mocks.blocked }))
vi.mock('./claude-oauth-usage-request', () => ({ fetchClaudeOAuthUsage: mocks.fetch }))
import { fetchInactiveClaudeAccountUsage } from './claude-managed-account-usage'
import { OAuthUsageError } from './claude-oauth-usage-error'
let directory: string
let credentialPath: string
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'claude-inactive-profile-'))
  credentialPath = join(directory, '.credentials.json')
  writeFileSync(credentialPath, '{"claudeAiOauth":{"accessToken":"synthetic"}}')
  mocks.prepare.mockReturnValue({
    configDir: directory,
    envPatch: { CLAUDE_CONFIG_DIR: directory },
    provenance: 'profile:A'
  })
  mocks.blocked.mockResolvedValue(null)
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
  vi.unstubAllGlobals()
})
it('observes an expired inactive token without refreshing or persisting credentials', async () => {
  const raw = JSON.stringify({
    claudeAiOauth: {
      accessToken: 'expired-synthetic',
      refreshToken: 'must-not-be-used',
      expiresAt: 1,
      refreshTokenExpiresAt: 4_102_444_800_000
    }
  })
  writeFileSync(credentialPath, raw)
  vi.stubGlobal('fetch', () => {
    throw new Error('Usage must not refresh credentials')
  })
  mocks.fetch.mockRejectedValue(new OAuthUsageError('Invalid OAuth token.', 401, true, null))
  const controller = new AbortController()
  const result = await fetchInactiveClaudeAccountUsage(
    { id: 'A', managedAuthRuntime: 'host' },
    { signal: controller.signal }
  )
  expect(mocks.prepare).toHaveBeenCalledWith('A')
  expect(mocks.fetch).toHaveBeenCalledWith('expired-synthetic', controller.signal)
  expect(readFileSync(credentialPath, 'utf8')).toBe(raw)
  expect(result).toMatchObject({
    status: 'error',
    usageMetadata: {
      failureKind: 'stale-token',
      credentialSource: 'credentials-file',
      attemptedSources: ['oauth']
    }
  })
})
it('preserves upstream 429 retry metadata on the current profile credential owner', async () => {
  mocks.fetch.mockRejectedValue(new OAuthUsageError('Synthetic wait', 429, true, 3600000))
  const started = Date.now()
  const result = await fetchInactiveClaudeAccountUsage({ id: 'A', managedAuthRuntime: 'host' })
  expect(result.usageMetadata).toMatchObject({
    failureKind: 'rate-limited',
    attemptedSources: ['oauth']
  })
  expect(result.usageMetadata?.retryAtMs).toBeGreaterThanOrEqual(started + 3600000)
  expect(mocks.prepare).toHaveBeenCalledWith('A')
  expect(mocks.fetch).toHaveBeenCalledWith('synthetic', undefined)
})
it('does not touch a stopped WSL distro credential path', async () => {
  mocks.blocked.mockResolvedValue({ distro: 'Ubuntu', state: 'stopped' })
  await fetchInactiveClaudeAccountUsage({ id: 'A', managedAuthRuntime: 'wsl', wslDistro: 'Ubuntu' })
  expect(mocks.wslPrepare).not.toHaveBeenCalled()
  expect(mocks.fetch).not.toHaveBeenCalled()
})
