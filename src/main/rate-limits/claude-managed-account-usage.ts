import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import { ClaudeManagedAuthStorage } from '../claude-accounts/claude-managed-auth-storage'
import {
  isOauthTokenExpiring,
  refreshClaudeOauthCredentials
} from '../claude-accounts/oauth-refresh'
import { hasLiveClaudePtys } from '../claude-accounts/live-pty-gate'
import { isWslDistroRunning } from '../wsl-background-distro-gate'
import { parseClaudeOAuthCredentialsJson } from './claude-oauth-credentials'
import { fetchClaudeOAuthUsage } from './claude-oauth-usage-request'
import { OAuthUsageError } from './claude-oauth-usage-error'
import { classifyClaudeOAuthUsageError } from './claude-usage-error-classification'
import {
  abortedClaudeRateLimitResult,
  claudeUsageUnavailable,
  makeClaudeUsageResult
} from './claude-usage-result'
import type { ClaudeManagedAccountUsageOptions } from './claude-usage-fetch-options'

export type InactiveClaudeAccount = Pick<
  ClaudeManagedAccount,
  'id' | 'managedAuthPath' | 'managedAuthRuntime' | 'wslDistro' | 'wslLinuxAuthPath'
>

/** Read the existing owned captured store; no profile-folder authority or login staging. */
export async function fetchInactiveClaudeAccountUsage(
  account: InactiveClaudeAccount,
  options: ClaudeManagedAccountUsageOptions = {}
): Promise<ProviderRateLimits> {
  if (options.signal?.aborted) {return abortedClaudeRateLimitResult()}
  if (
    account.managedAuthRuntime === 'wsl' &&
    (!account.wslDistro || !(await isWslDistroRunning(account.wslDistro)))
  )
    {return claudeUsageUnavailable()}
  const storage = new ClaudeManagedAuthStorage()
  let raw: string | null
  try {
    raw = (await storage.readSnapshot(account.id, account.managedAuthPath)).credentialsJson
  } catch {
    return claudeUsageUnavailable()
  }
  if (!raw)
    {return makeClaudeUsageResult('error', 'Sign in again to use this account.', {
      failureKind: 'missing-credentials',
      attemptedSources: []
    })}
  if (options.signal?.aborted) {return abortedClaudeRateLimitResult()}
  // A surviving CLI may still own this token even when another account is selected.
  if (isOauthTokenExpiring(raw) && !hasLiveClaudePtys()) {
    const refreshed = await refreshClaudeOauthCredentials(raw)
    if (refreshed) {
      try {
        await storage.writeCredentials(account.id, account.managedAuthPath, refreshed)
      } catch {
        return claudeUsageUnavailable()
      }
      raw = refreshed
    }
  }
  if (options.signal?.aborted) {return abortedClaudeRateLimitResult()}
  const source = process.platform === 'darwin' ? 'scoped-keychain' : 'credentials-file'
  const token = parseClaudeOAuthCredentialsJson(raw, source).token
  if (!token) {return claudeUsageUnavailable()}
  try {
    return await fetchClaudeOAuthUsage(token, options.signal)
  } catch (error) {
    const { failureKind } = classifyClaudeOAuthUsageError(error)
    const retryAfterMs = error instanceof OAuthUsageError ? error.retryAfterMs : null
    return makeClaudeUsageResult(
      'error',
      error instanceof OAuthUsageError ? error.message : 'Claude usage is unavailable.',
      {
        failureKind,
        credentialSource: source,
        attemptedSources: ['oauth'],
        ...(retryAfterMs ? { retryAtMs: Date.now() + retryAfterMs } : {})
      }
    )
  }
}
