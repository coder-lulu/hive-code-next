import { randomUUID } from 'node:crypto'
import type { ClaudeAccountSignIn, ClaudeSignInRequest } from '../../shared/managed-account-types'
import type { CapturedClaudeAuth } from './claude-auth-capture'
import type { ClaudeCommandConfig } from './claude-command-process'
import {
  createTemporaryClaudeConfigDir,
  removeTemporaryClaudeConfigDir
} from './claude-login-session'
import {
  deleteActiveClaudeKeychainCredentialsStrict,
  readActiveClaudeKeychainCredentialsStrict,
  writeActiveClaudeKeychainCredentials
} from './keychain'
import {
  normalizeClaudeAccountSelectionTarget,
  type ClaudeAccountSelectionTarget
} from './runtime-selection'

const SIGN_IN_LIFETIME_MS = 10 * 60_000

type PendingSignIn = {
  folder: ClaudeCommandConfig
  target: ClaudeAccountSelectionTarget
  savedAccountId?: string
  previousLegacy: string | null
  timer: ReturnType<typeof setTimeout>
}

/** Opaque, expiring host-local attempts; no caller-supplied folder is accepted at finish. */
export class ClaudeTerminalSignIn {
  private readonly pending = new Map<string, PendingSignIn>()

  hasPending(): boolean {
    return this.pending.size > 0
  }

  constructor(
    private readonly resolveAccountTarget: (id: string) => ClaudeAccountSelectionTarget
  ) {}

  async begin(request: ClaudeSignInRequest): Promise<ClaudeAccountSignIn> {
    const target = normalizeClaudeAccountSelectionTarget(
      request.accountId ? this.resolveAccountTarget(request.accountId) : request
    )
    if (target.runtime === 'wsl' && !target.wslDistro)
      {throw new Error('Choose a WSL distro before signing in.')}
    // Only one interactive login can own the shared macOS legacy Keychain at a time.
    if (this.pending.size) {throw new Error('Finish or cancel the current Claude sign-in first.')}
    const previousLegacy = await readActiveClaudeKeychainCredentialsStrict()
    const folder = await createTemporaryClaudeConfigDir({
      managedAuthPath: '',
      managedAuthRuntime: target.runtime,
      wslDistro: target.wslDistro,
      wslLinuxAuthPath: null
    })
    const accountId = randomUUID()
    const timer = setTimeout(() => {
      void this.cancel({ accountId, ...target }).catch(() => {})
    }, SIGN_IN_LIFETIME_MS)
    timer.unref()
    this.pending.set(accountId, {
      folder,
      target,
      savedAccountId: request.accountId,
      previousLegacy,
      timer
    })
    return { accountId, configDir: folder.linuxPath ?? folder.windowsPath, ...target }
  }

  async finish<T>(
    signIn: Omit<ClaudeAccountSignIn, 'configDir'>,
    capture: (folder: ClaudeCommandConfig, previous: string | null) => Promise<CapturedClaudeAuth>,
    commit: (
      captured: CapturedClaudeAuth,
      target: ClaudeAccountSelectionTarget,
      savedAccountId: string | undefined,
      accountId: string
    ) => Promise<T>
  ): Promise<T> {
    const attempt = this.require(signIn)
    const captured = await capture(attempt.folder, attempt.previousLegacy)
    // Capture can block; an expired/cancelled attempt never gains commit authority.
    if (this.pending.get(signIn.accountId) !== attempt)
      {throw new Error('Claude sign-in expired. Start again.')}
    clearTimeout(attempt.timer)
    this.pending.delete(signIn.accountId)
    try {
      return await commit(captured, attempt.target, attempt.savedAccountId, signIn.accountId)
    } finally {
      try {
        if (
          process.platform === 'darwin' &&
          (await readActiveClaudeKeychainCredentialsStrict()) === captured.credentialsJson
        ) {
          await (attempt.previousLegacy
            ? writeActiveClaudeKeychainCredentials(attempt.previousLegacy)
            : deleteActiveClaudeKeychainCredentialsStrict())
        }
      } finally {
        await this.cleanup(attempt)
      }
    }
  }

  async cancel(signIn: Omit<ClaudeAccountSignIn, 'configDir'>): Promise<void> {
    const attempt = this.require(signIn)
    this.pending.delete(signIn.accountId)
    clearTimeout(attempt.timer)
    await this.cleanup(attempt)
  }

  private require(signIn: Omit<ClaudeAccountSignIn, 'configDir'>): PendingSignIn {
    const attempt = this.pending.get(signIn.accountId)
    const target = normalizeClaudeAccountSelectionTarget(signIn)
    if (
      !attempt ||
      target.runtime !== attempt.target.runtime ||
      target.wslDistro !== attempt.target.wslDistro
    )
      {throw new Error('Claude sign-in expired or belongs to another runtime. Start again.')}
    return attempt
  }

  private async cleanup(attempt: PendingSignIn): Promise<void> {
    try {
      if (process.platform === 'darwin')
        {await deleteActiveClaudeKeychainCredentialsStrict(attempt.folder.windowsPath)}
    } finally {
      await removeTemporaryClaudeConfigDir(attempt.folder)
    }
  }
}
