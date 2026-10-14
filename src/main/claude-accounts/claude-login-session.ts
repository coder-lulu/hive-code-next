import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toWindowsWslPath } from '../wsl'
import { runWslProcess } from '../wsl/wsl-runner'
import type { CapturedClaudeAuth } from './claude-auth-capture'
import type { ClaudeCommandConfig, ClaudeCommandOptions } from './claude-command-process'
import type { ClaudeManagedAuthLocation } from './claude-managed-auth-storage'
import {
  deleteActiveClaudeKeychainCredentialsStrict,
  readActiveClaudeKeychainCredentialsStrict,
  writeActiveClaudeKeychainCredentials
} from './keychain'

import { prepareClaudeSignInBrowser, type ClaudeSignInBrowser } from './claude-sign-in-browser'
import { CLAUDE_SIGN_IN_FAILED_MESSAGE } from '../../shared/claude-sign-in-link'

const LOGIN_TIMEOUT_MS = 600_000
const STATUS_TIMEOUT_MS = 20_000

type ClaudeLoginSessionDependencies = {
  runCommand: (
    args: string[],
    config: ClaudeCommandConfig,
    timeoutMs: number,
    options?: ClaudeCommandOptions
  ) => Promise<string>
  capture: (
    configDir: string,
    statusOutput: string,
    previousLegacyKeychain: string | null
  ) => Promise<CapturedClaudeAuth>
  setCancel: (cancel: (() => boolean) | null) => void
}

export async function runClaudeLoginSession(
  location: ClaudeManagedAuthLocation,
  dependencies: ClaudeLoginSessionDependencies,
  onLink?: (link: string) => void
): Promise<CapturedClaudeAuth> {
  const tempConfig = await createTemporaryClaudeConfigDir(location)
  const controller = new AbortController()
  const watch = new AbortController()
  let browser: ClaudeSignInBrowser | null = null
  let linkMissing = false
  let previousLegacyKeychain: string | null = null
  let acquiredLegacySnapshot = false
  let captured: CapturedClaudeAuth | null = null
  let captureFailure: { error: unknown } | null = null
  let cleanupFailure: { error: unknown } | null = null
  try {
    dependencies.setCancel(() => {
      if (controller.signal.aborted) {
        return false
      }
      controller.abort()
      return true
    })
    previousLegacyKeychain = await readActiveClaudeKeychainCredentialsStrict()
    acquiredLegacySnapshot = true
    if (controller.signal.aborted) {
      throw new Error('Claude sign-in was cancelled.')
    }
    browser = onLink ? await prepareClaudeSignInBrowser(tempConfig) : null
    void browser
      ?.nextLink(watch.signal)
      .then((link) => {
        if (link && !watch.signal.aborted) {onLink?.(link)}
        else if (!watch.signal.aborted) {
          linkMissing = true
          controller.abort()
        }
      })
      .catch(() => {
        if (!watch.signal.aborted) {
          linkMissing = true
          controller.abort()
        }
      })
    await dependencies.runCommand(['auth', 'login', '--claudeai'], tempConfig, LOGIN_TIMEOUT_MS, {
      signal: controller.signal,
      keepStdinOpen: true,
      browser: browser?.path
    })
    dependencies.setCancel(null)
    const status = await dependencies.runCommand(
      ['auth', 'status', '--json'],
      tempConfig,
      STATUS_TIMEOUT_MS,
      { allowFailure: true }
    )
    captured = await dependencies.capture(tempConfig.windowsPath, status, previousLegacyKeychain)
  } catch (error) {
    captureFailure = { error: linkMissing ? new Error(CLAUDE_SIGN_IN_FAILED_MESSAGE) : error }
  } finally {
    watch.abort()
    await browser?.dispose().catch(() => {})
    if (process.platform === 'darwin' && acquiredLegacySnapshot) {
      try {
        await deleteActiveClaudeKeychainCredentialsStrict(tempConfig.windowsPath)
      } catch (error) {
        console.warn('[claude-accounts] Failed to clean temporary Claude Keychain item:', error)
      }
      try {
        await (previousLegacyKeychain
          ? writeActiveClaudeKeychainCredentials(previousLegacyKeychain)
          : deleteActiveClaudeKeychainCredentialsStrict())
      } catch (error) {
        cleanupFailure = { error }
      }
    }
    try {
      await removeTemporaryClaudeConfigDir(tempConfig)
    } catch (error) {
      cleanupFailure ??= { error }
    } finally {
      dependencies.setCancel(null)
    }
  }
  if (captureFailure) {
    throw captureFailure.error
  }
  if (cleanupFailure) {
    throw cleanupFailure.error
  }
  return captured!
}

export async function createTemporaryClaudeConfigDir(
  location: ClaudeManagedAuthLocation
): Promise<ClaudeCommandConfig> {
  if (location.managedAuthRuntime !== 'wsl') {
    const created = mkdtempSync(join(tmpdir(), 'orca-claude-login-'))
    let windowsPath = created
    try {
      windowsPath = realpathSync(created)
    } catch {
      // Keep the mkdtemp path if the temp root cannot be resolved.
    }
    return {
      windowsPath,
      linuxPath: null,
      wslDistro: null
    }
  }
  if (!location.wslDistro) {
    throw new Error('Could not resolve the active WSL distribution for Claude login.')
  }
  const created = await runWslProcess({
    distro: location.wslDistro,
    loginPath: 'none',
    shell: 'bash',
    script: 'mktemp -d "${TMPDIR:-/tmp}/orca-claude-login.XXXXXX"',
    timeoutMs: 5000
  })
  const linuxPath = created.stdout.replaceAll(String.fromCharCode(0), '').trim()
  if (created.code !== 0 || created.timedOut || !linuxPath.startsWith('/')) {
    throw new Error('Could not create a temporary WSL Claude login directory.')
  }
  return {
    windowsPath: toWindowsWslPath(linuxPath, location.wslDistro),
    linuxPath,
    wslDistro: location.wslDistro
  }
}

export async function removeTemporaryClaudeConfigDir(config: ClaudeCommandConfig): Promise<void> {
  if (config.linuxPath && config.wslDistro) {
    try {
      await runWslProcess({
        distro: config.wslDistro,
        loginPath: 'none',
        program: 'rm',
        args: ['-rf', '--', config.linuxPath],
        timeoutMs: 5000
      })
    } catch {
      // Cleanup cannot mask the login result.
    }
    return
  }
  rmSync(config.windowsPath, { recursive: true, force: true })
}
