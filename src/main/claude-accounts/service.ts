/* eslint-disable max-lines -- Why: Claude managed accounts need one audited owner
for login, credential capture, Keychain storage, selection, and rate-limit refresh. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { applyProductBranding } from '../../shared/brand'
import type {
  ClaudeManagedAccount,
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../shared/managed-account-types'
import type { Store } from '../persistence'
import type { RateLimitService } from '../rate-limits/service'
import type { ClaudeRuntimeAuthService } from './runtime-auth-service'
import { readActiveClaudeKeychainCredentialsStrict } from './keychain'
import { beginClaudeAuthSwitch, endClaudeAuthSwitch } from './live-pty-gate'
import { findDuplicateClaudeAccount } from './claude-duplicate-account'
import { runClaudeLoginSession } from './claude-login-session'
import { ClaudeManagedAuthStorage } from './claude-managed-auth-storage'
import { runClaudeCommandProcess } from './claude-command-process'
import {
  getClaudeSelectionTargetForAccount,
  getSelectedClaudeAccountIdForTarget,
  normalizeClaudeAccountSelectionTarget,
  normalizeClaudeRuntimeSelection,
  pruneInvalidClaudeRuntimeSelection,
  removeClaudeAccountIdFromSelection,
  setSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from './runtime-selection'

const STATUS_TIMEOUT_MS = 20_000

type ClaudeIdentity = {
  email: string | null
  organizationUuid: string | null
  organizationName: string | null
}

type CapturedClaudeAuth = {
  credentialsJson: string
  oauthAccount: unknown
  identity: ClaudeIdentity
}

type ManagedClaudeAuthSnapshot = {
  credentialsJson: string | null
  oauthAccountJson: string | null
}

export type ClaudeAccountAddTarget = {
  runtime?: 'host' | 'wsl'
  wslDistro?: string | null
}

export type ClaudeAccountImportOptions = ClaudeAccountAddTarget & {
  previousLegacyCredentialsSha256?: string | null
}

type ManagedClaudeAuthLocation = {
  managedAuthPath: string
  managedAuthRuntime: 'host' | 'wsl'
  wslDistro: string | null
  wslLinuxAuthPath: string | null
}

class DuplicateClaudeAccountError extends Error {}

export class ClaudeAccountService {
  private readonly storage = new ClaudeManagedAuthStorage()
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private cancelPendingClaudeLogin: (() => boolean) | null = null

  constructor(
    private readonly store: Store,
    private readonly rateLimits: RateLimitService,
    private readonly runtimeAuth: ClaudeRuntimeAuthService
  ) {}

  listAccounts(): ClaudeRateLimitAccountsState {
    this.normalizeActiveSelection()
    return this.getSnapshot()
  }

  async addAccount(target?: ClaudeAccountAddTarget): Promise<ClaudeRateLimitAccountsState> {
    this.supersedePendingLogin()
    return this.serializeMutation(() => this.doAddAccount(target))
  }

  /**
   * Adds a managed Claude account from an already-authenticated `CLAUDE_CONFIG_DIR`
   * instead of driving the interactive browser login here. Enables the
   * `orca account add` CLI to run `claude login` in the user's own terminal on a
   * headless host, then register the captured credentials without a desktop GUI.
   */
  async addAccountFromConfigDir(
    configDir: string,
    options?: ClaudeAccountImportOptions
  ): Promise<ClaudeRateLimitAccountsState> {
    this.supersedePendingLogin()
    return this.serializeMutation(() => this.doAddAccountFromConfigDir(configDir, options))
  }

  async reauthenticateAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    this.supersedePendingLogin()
    return this.serializeMutation(() => this.doReauthenticateAccount(accountId))
  }

  async removeAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    this.supersedePendingLogin()
    return this.serializeMutation(() => this.doRemoveAccount(accountId))
  }

  async selectAccount(accountId: string | null): Promise<ClaudeRateLimitAccountsState> {
    this.supersedePendingLogin()
    return this.serializeMutation(() => this.doSelectAccount(accountId))
  }

  async selectAccountForTarget(
    accountId: string | null,
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRateLimitAccountsState> {
    this.supersedePendingLogin()
    return this.serializeMutation(() => this.doSelectAccount(accountId, target))
  }

  cancelPendingLogin(): boolean {
    return this.cancelPendingClaudeLogin?.() ?? false
  }

  // Why before the queue, not inside it: the abandoned login owns the queue slot
  // every later account action waits for. Called from the four the user drives,
  // never from serializeMutation, which background work also uses.
  private supersedePendingLogin(): void {
    if (this.cancelPendingLogin()) {
      console.info(
        '[claude-accounts] Cancelled a pending Claude login superseded by a new request.'
      )
    }
  }

  getRuntimeConfigDir(target?: ClaudeAccountSelectionTarget): string {
    return this.runtimeAuth.getRuntimeConfigDir(target)
  }

  private serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(fn, fn)
    this.mutationQueue = next.catch(() => {})
    return next
  }

  private async doAddAccount(
    target?: ClaudeAccountAddTarget
  ): Promise<ClaudeRateLimitAccountsState> {
    const accountId = randomUUID()
    const managedAuth = await this.createManagedAuthDir(accountId, target)
    const previousSettings = this.store.getSettings()
    try {
      const captured = await this.runClaudeLoginAndCapture(managedAuth)
      return await this.persistCapturedClaudeAccount(
        accountId,
        managedAuth,
        previousSettings,
        captured
      )
    } catch (error) {
      await this.cleanupFailedAdd(accountId, managedAuth.managedAuthPath, previousSettings, error)
      throw error
    }
  }

  private async doAddAccountFromConfigDir(
    configDir: string,
    options?: ClaudeAccountImportOptions
  ): Promise<ClaudeRateLimitAccountsState> {
    const accountId = randomUUID()
    const managedAuth = await this.createManagedAuthDir(accountId, options)
    const previousSettings = this.store.getSettings()
    try {
      const captured = await this.captureFromExistingConfigDir(
        configDir,
        options?.previousLegacyCredentialsSha256
      )
      return await this.persistCapturedClaudeAccount(
        accountId,
        managedAuth,
        previousSettings,
        captured
      )
    } catch (error) {
      await this.cleanupFailedAdd(accountId, managedAuth.managedAuthPath, previousSettings, error)
      throw error
    }
  }

  // Why: capture credentials from a CLAUDE_CONFIG_DIR the caller already
  // authenticated (e.g. a temp dir the CLI ran `claude login` into), mirroring
  // runClaudeLoginAndCapture's capture step but without spawning the interactive
  // login. On Linux/Windows the credentials live in a plaintext `.credentials.json`.
  private async captureFromExistingConfigDir(
    configDir: string,
    previousLegacyCredentialsSha256?: string | null
  ): Promise<CapturedClaudeAuth> {
    const trimmed = configDir.trim()
    if (!trimmed) {
      throw new Error('A Claude config directory path is required.')
    }
    const resolvedDir = resolve(trimmed)
    // Why: macOS keeps Claude credentials in the Keychain rather than a file, so
    // only require `.credentials.json` off-darwin; captureAuthFromConfigDir reads
    // the scoped Keychain item on macOS.
    if (process.platform !== 'darwin' && !existsSync(join(resolvedDir, '.credentials.json'))) {
      throw new Error(
        `No Claude credentials found in ${resolvedDir}. Run \`claude login\` into this directory first.`
      )
    }
    // Why: `allowFailure` covers a non-zero exit but not a spawn error, and unlike
    // the GUI flow nothing has run `claude` in this process yet — a daemon started
    // with a minimal PATH (launchd/systemd) would hard-fail an add the user already
    // signed in for. Identity still resolves from the config dir's oauthAccount.
    let status = ''
    try {
      status = await this.runClaudeCommand(
        ['auth', 'status', '--json'],
        { windowsPath: resolvedDir, linuxPath: null, wslDistro: null },
        STATUS_TIMEOUT_MS,
        { allowFailure: true }
      )
    } catch (error) {
      console.warn('[claude-accounts] Could not read `claude auth status`:', error)
    }
    // Why: this post-login RPC did not observe the legacy Keychain value before
    // login unless the CLI supplied its one-way pre-login credential baseline.
    const currentLegacyKeychain = await readActiveClaudeKeychainCredentialsStrict()
    return this.captureAuthFromConfigDir(
      resolvedDir,
      status,
      currentLegacyKeychain,
      previousLegacyCredentialsSha256
    )
  }

  private async persistCapturedClaudeAccount(
    accountId: string,
    managedAuth: ManagedClaudeAuthLocation,
    previousSettings: ReturnType<Store['getSettings']>,
    captured: CapturedClaudeAuth
  ): Promise<ClaudeRateLimitAccountsState> {
    if (!captured.identity.email) {
      throw new Error(
        applyProductBranding(
          'Claude login completed, but Orca could not resolve the account email.'
        )
      )
    }
    // Why: duplicate rows confuse selection and rate-limit tracking; re-authentication
    // is the supported way to refresh an account that is already managed.
    if (
      findDuplicateClaudeAccount(previousSettings.claudeManagedAccounts, {
        email: captured.identity.email,
        organizationUuid: captured.identity.organizationUuid,
        managedAuthRuntime: managedAuth.managedAuthRuntime,
        wslDistro: managedAuth.wslDistro
      })
    ) {
      throw new DuplicateClaudeAccountError('This Claude account is already added.')
    }
    await this.writeManagedAuth(accountId, managedAuth.managedAuthPath, captured)

    const now = Date.now()
    const account: ClaudeManagedAccount = {
      id: accountId,
      email: captured.identity.email,
      managedAuthPath: managedAuth.managedAuthPath,
      managedAuthRuntime: managedAuth.managedAuthRuntime,
      wslDistro: managedAuth.wslDistro,
      wslLinuxAuthPath: managedAuth.wslLinuxAuthPath,
      authMethod: 'subscription-oauth',
      organizationUuid: captured.identity.organizationUuid,
      organizationName: captured.identity.organizationName,
      createdAt: now,
      updatedAt: now,
      lastAuthenticatedAt: now
    }

    const selection = normalizeClaudeRuntimeSelection(previousSettings)
    this.store.updateSettings({
      claudeManagedAccounts: [...previousSettings.claudeManagedAccounts, account],
      activeClaudeManagedAccountId: selection.host,
      activeClaudeManagedAccountIdsByRuntime: selection
    })
    this.runtimeAuth.clearLastWrittenCredentialsJson(accountId)
    this.rateLimits.evictInactiveClaudeCache(accountId)
    return this.getSnapshot()
  }

  private async rollbackAddAccount(
    accountId: string,
    managedAuthPath: string,
    previousSettings: ReturnType<Store['getSettings']>
  ): Promise<void> {
    this.restoreClaudeSettings(previousSettings)
    // Why: rollback is best-effort — a failed rematerialization must not skip the
    // managed-auth cleanup below, and the caller rethrows the original add error.
    try {
      await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
    } catch (rollbackError) {
      console.warn('[claude-accounts] Rollback rematerialization failed:', rollbackError)
    }
    await this.safeRemoveManagedAuth(accountId, managedAuthPath)
  }

  private async cleanupFailedAdd(
    accountId: string,
    managedAuthPath: string,
    previousSettings: ReturnType<Store['getSettings']>,
    error: unknown
  ): Promise<void> {
    if (error instanceof DuplicateClaudeAccountError) {
      // Why: duplicate detection precedes writes; rollback I/O could only mask
      // the useful duplicate-account error.
      await this.safeRemoveManagedAuth(accountId, managedAuthPath)
      return
    }
    await this.rollbackAddAccount(accountId, managedAuthPath, previousSettings)
  }

  private async doReauthenticateAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    const account = this.requireAccount(accountId)
    const managedAuthPath = await this.assertManagedAuthPath(account.managedAuthPath, accountId)
    const previousSettings = this.store.getSettings()
    const previousManagedAuth = await this.readManagedAuthSnapshot(accountId, managedAuthPath)
    const captured = await this.runClaudeLoginAndCapture({
      managedAuthPath,
      managedAuthRuntime: account.managedAuthRuntime ?? 'host',
      wslDistro: account.wslDistro ?? null,
      wslLinuxAuthPath: account.wslLinuxAuthPath ?? null
    })
    if (!captured.identity.email) {
      throw new Error(
        applyProductBranding(
          'Claude login completed, but Orca could not resolve the account email.'
        )
      )
    }

    const settings = this.store.getSettings()
    const now = Date.now()
    const reauthenticatedAccounts = settings.claudeManagedAccounts.map((entry) =>
      entry.id === accountId
        ? {
            ...entry,
            email: captured.identity.email!,
            organizationUuid: captured.identity.organizationUuid,
            organizationName: captured.identity.organizationName,
            updatedAt: now,
            lastAuthenticatedAt: now
          }
        : entry
    )
    let wroteManagedCredentials = false
    try {
      await this.writeManagedOauthAccount(accountId, managedAuthPath, captured.oauthAccount)
      await this.writeManagedCredentials(accountId, managedAuthPath, captured.credentialsJson)
      wroteManagedCredentials = true
      this.store.updateSettings({ claudeManagedAccounts: reauthenticatedAccounts })
      this.runtimeAuth.clearLastWrittenCredentialsJson(accountId)
      this.rateLimits.evictInactiveClaudeCache(accountId)
      await this.syncRuntimeAuthWithLivePtyGate(getClaudeSelectionTargetForAccount(account))
      await this.rateLimits.refreshForClaudeAccountChange(
        undefined,
        getClaudeSelectionTargetForAccount(account)
      )
      return this.getSnapshot()
    } catch (error) {
      let restoredManagedCredentials = false
      try {
        await this.restoreManagedCredentialsSnapshot(
          accountId,
          managedAuthPath,
          previousManagedAuth
        )
        restoredManagedCredentials = true
      } catch (rollbackError) {
        console.warn(
          '[claude-accounts] Failed to restore managed credentials during rollback:',
          rollbackError
        )
      }
      if (restoredManagedCredentials || !wroteManagedCredentials) {
        try {
          await this.restoreManagedOauthSnapshot(accountId, managedAuthPath, previousManagedAuth)
        } catch (rollbackError) {
          console.warn(
            '[claude-accounts] Failed to restore managed oauth metadata during rollback:',
            rollbackError
          )
        }
      }
      if (restoredManagedCredentials) {
        this.restoreClaudeSettings(previousSettings)
        await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
      } else if (wroteManagedCredentials) {
        this.store.updateSettings({ claudeManagedAccounts: reauthenticatedAccounts })
      } else {
        this.restoreClaudeSettings(previousSettings)
      }
      throw error
    }
  }

  private async doRemoveAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    const account = this.requireAccount(accountId)
    const settings = this.store.getSettings()
    const nextAccounts = settings.claudeManagedAccounts.filter((entry) => entry.id !== accountId)
    const nextSelection = removeClaudeAccountIdFromSelection(
      normalizeClaudeRuntimeSelection(settings),
      accountId
    )
    const nextActiveId =
      settings.activeClaudeManagedAccountId === accountId ? null : nextSelection.host

    try {
      if (
        getSelectedClaudeAccountIdForTarget(
          settings,
          getClaudeSelectionTargetForAccount(account)
        ) === accountId
      ) {
        this.store.updateSettings({
          activeClaudeManagedAccountId: nextActiveId,
          activeClaudeManagedAccountIdsByRuntime: nextSelection
        })
        await this.syncRuntimeAuthWithLivePtyGate(getClaudeSelectionTargetForAccount(account))
        this.store.updateSettings({ claudeManagedAccounts: nextAccounts })
      } else {
        this.store.updateSettings({
          claudeManagedAccounts: nextAccounts,
          activeClaudeManagedAccountId: nextActiveId,
          activeClaudeManagedAccountIdsByRuntime: nextSelection
        })
        await this.syncRuntimeAuthWithLivePtyGate(getClaudeSelectionTargetForAccount(account))
      }
      await this.safeRemoveManagedAuth(accountId, account.managedAuthPath)
      this.rateLimits.evictInactiveClaudeCache(accountId)
      await this.rateLimits.refreshForClaudeAccountChange(
        getSelectedClaudeAccountIdForTarget(
          settings,
          getClaudeSelectionTargetForAccount(account)
        ) === accountId
          ? accountId
          : undefined,
        getClaudeSelectionTargetForAccount(account)
      )
      return this.getSnapshot()
    } catch (error) {
      this.restoreClaudeSettings(settings)
      await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
      throw error
    }
  }

  private async doSelectAccount(
    accountId: string | null,
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRateLimitAccountsState> {
    let effectiveTarget = target
    if (accountId !== null) {
      const account = this.requireAccount(accountId)
      const accountTarget = getClaudeSelectionTargetForAccount(account)
      const requestedTarget = normalizeClaudeAccountSelectionTarget(target ?? accountTarget)
      const normalizedAccountTarget = normalizeClaudeAccountSelectionTarget(accountTarget)
      if (
        requestedTarget.runtime !== normalizedAccountTarget.runtime ||
        (requestedTarget.wslDistro !== null &&
          requestedTarget.wslDistro !== normalizedAccountTarget.wslDistro)
      ) {
        throw new Error('That Claude account belongs to a different runtime.')
      }
      effectiveTarget = accountTarget
    }
    const previousSettings = this.store.getSettings()
    const selection = normalizeClaudeRuntimeSelection(previousSettings)
    const outgoingAccountId = getSelectedClaudeAccountIdForTarget(previousSettings, effectiveTarget)
    const nextSelection = setSelectedClaudeAccountIdForTarget(selection, accountId, effectiveTarget)
    this.store.updateSettings({
      activeClaudeManagedAccountId:
        effectiveTarget?.runtime === 'wsl' ? nextSelection.host : accountId,
      activeClaudeManagedAccountIdsByRuntime: nextSelection
    })
    try {
      await this.syncRuntimeAuthWithLivePtyGate(effectiveTarget)
      await this.rateLimits.refreshForClaudeAccountChange(outgoingAccountId, effectiveTarget)
      return this.getSnapshot()
    } catch (error) {
      this.restoreClaudeSettings(previousSettings)
      await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
      throw error
    }
  }

  private getSnapshot(): ClaudeRateLimitAccountsState {
    const settings = this.store.getSettings()
    return {
      accounts: settings.claudeManagedAccounts
        .map((account) => this.toSummary(account))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      activeAccountId: normalizeClaudeRuntimeSelection(settings).host,
      activeAccountIdsByRuntime: normalizeClaudeRuntimeSelection(settings)
    }
  }

  private toSummary(account: ClaudeManagedAccount): ClaudeManagedAccountSummary {
    return {
      id: account.id,
      email: account.email,
      managedAuthRuntime: account.managedAuthRuntime ?? 'host',
      wslDistro: account.wslDistro ?? null,
      authMethod: account.authMethod ?? 'unknown',
      organizationUuid: account.organizationUuid ?? null,
      organizationName: account.organizationName ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastAuthenticatedAt: account.lastAuthenticatedAt
    }
  }

  private requireAccount(accountId: string): ClaudeManagedAccount {
    const account = this.store
      .getSettings()
      .claudeManagedAccounts.find((entry) => entry.id === accountId)
    if (!account) {
      throw new Error('That Claude account no longer exists.')
    }
    return account
  }

  private normalizeActiveSelection(): void {
    const settings = this.store.getSettings()
    const nextSelection = pruneInvalidClaudeRuntimeSelection(
      normalizeClaudeRuntimeSelection(settings),
      settings.claudeManagedAccounts
    )
    if (
      nextSelection.host !== settings.activeClaudeManagedAccountId ||
      JSON.stringify(nextSelection) !== JSON.stringify(normalizeClaudeRuntimeSelection(settings))
    ) {
      this.store.updateSettings({
        activeClaudeManagedAccountId: nextSelection.host,
        activeClaudeManagedAccountIdsByRuntime: nextSelection
      })
    }
  }

  private restoreClaudeSettings(settings: ReturnType<Store['getSettings']>): void {
    this.store.updateSettings({
      claudeManagedAccounts: settings.claudeManagedAccounts,
      activeClaudeManagedAccountId: settings.activeClaudeManagedAccountId,
      activeClaudeManagedAccountIdsByRuntime: settings.activeClaudeManagedAccountIdsByRuntime
    })
  }

  private async syncRuntimeAuthWithLivePtyGate(
    target?: ClaudeAccountSelectionTarget,
    operation?: () => Promise<void>
  ): Promise<void> {
    beginClaudeAuthSwitch()
    try {
      await (operation ? operation() : this.runtimeAuth.syncForCurrentSelection(target))
    } finally {
      endClaudeAuthSwitch()
    }
  }

  private async runClaudeLoginAndCapture(
    location: ManagedClaudeAuthLocation = {
      managedAuthPath: '',
      managedAuthRuntime: 'host',
      wslDistro: null,
      wslLinuxAuthPath: null
    }
  ): Promise<CapturedClaudeAuth> {
    return runClaudeLoginSession(location, {
      runCommand: (args, config, timeoutMs, options) =>
        this.runClaudeCommand(args, config, timeoutMs, options),
      capture: (configDir, statusOutput, previousLegacyKeychain) =>
        this.captureAuthFromConfigDir(configDir, statusOutput, previousLegacyKeychain),
      setCancel: (cancel) => {
        this.cancelPendingClaudeLogin = cancel
      }
    })
  }

  private async captureAuthFromConfigDir(
    configDir: string,
    statusOutput: string,
    previousLegacyKeychain: string | null,
    previousLegacyCredentialsSha256?: string | null
  ): Promise<CapturedClaudeAuth> {
    const credentialsJson = await this.readCapturedCredentials(
      configDir,
      previousLegacyKeychain,
      previousLegacyCredentialsSha256
    )
    if (!credentialsJson) {
      throw new Error('Claude login completed, but no OAuth credentials were captured.')
    }
    const oauthAccount = this.readOauthAccountFromConfigDir(configDir)
    const identity = this.resolveIdentity(statusOutput, oauthAccount, credentialsJson)
    return { credentialsJson, oauthAccount, identity }
  }

  private async readCapturedCredentials(
    configDir: string,
    previousLegacyKeychain: string | null,
    previousLegacyCredentialsSha256?: string | null
  ): Promise<string | null> {
    if (process.platform === 'darwin') {
      const scopedCredentialsJson = await readActiveClaudeKeychainCredentialsStrict(configDir)
      if (scopedCredentialsJson) {
        return scopedCredentialsJson
      }
      const legacyCredentialsJson = await readActiveClaudeKeychainCredentialsStrict()
      const legacyChanged =
        previousLegacyCredentialsSha256 === undefined
          ? legacyCredentialsJson !== previousLegacyKeychain
          : legacyCredentialsJson !== null &&
            createHash('sha256').update(legacyCredentialsJson).digest('hex') !==
              previousLegacyCredentialsSha256
      if (legacyCredentialsJson && legacyChanged) {
        return legacyCredentialsJson
      }
    }
    const credentialsPath = join(configDir, '.credentials.json')
    return existsSync(credentialsPath) ? readFileSync(credentialsPath, 'utf-8') : null
  }

  private readOauthAccountFromConfigDir(configDir: string): unknown {
    for (const configPath of [join(configDir, '.claude.json'), join(configDir, '.config.json')]) {
      if (!existsSync(configPath)) {
        continue
      }
      try {
        const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
        if (parsed.oauthAccount) {
          return parsed.oauthAccount
        }
      } catch {
        continue
      }
    }
    return null
  }

  private resolveIdentity(
    statusOutput: string,
    oauthAccount: unknown,
    credentialsJson: string
  ): ClaudeIdentity {
    const status = this.parseJsonObject(statusOutput)
    const oauth = this.asRecord(oauthAccount)
    const credentials = this.parseJsonObject(credentialsJson)
    const credentialOauth = this.asRecord(credentials?.claudeAiOauth)

    return {
      email: this.normalizeField(
        this.readString(status, 'email') ??
          this.readString(oauth, 'emailAddress') ??
          this.readString(oauth, 'email') ??
          this.readString(credentialOauth, 'email')
      ),
      organizationUuid: this.normalizeField(
        this.readString(status, 'organizationUuid') ??
          this.readString(status, 'organizationId') ??
          this.readString(oauth, 'organizationUuid') ??
          this.readString(oauth, 'organizationId')
      ),
      organizationName: this.normalizeField(
        this.readString(status, 'organizationName') ?? this.readString(oauth, 'organizationName')
      )
    }
  }

  private async writeManagedAuth(
    accountId: string,
    managedAuthPath: string,
    captured: CapturedClaudeAuth
  ): Promise<void> {
    await this.writeManagedCredentials(accountId, managedAuthPath, captured.credentialsJson)
    await this.writeManagedOauthAccount(accountId, managedAuthPath, captured.oauthAccount)
  }

  private writeManagedCredentials(
    accountId: string,
    managedAuthPath: string,
    credentialsJson: string
  ): Promise<void> {
    return this.storage.writeCredentials(accountId, managedAuthPath, credentialsJson)
  }

  private writeManagedOauthAccount(
    accountId: string,
    managedAuthPath: string,
    oauthAccount: unknown
  ): Promise<void> {
    return this.storage.writeOauthAccount(accountId, managedAuthPath, oauthAccount)
  }

  private readManagedAuthSnapshot(
    accountId: string,
    managedAuthPath: string
  ): Promise<ManagedClaudeAuthSnapshot> {
    return this.storage.readSnapshot(accountId, managedAuthPath)
  }

  private restoreManagedCredentialsSnapshot(
    accountId: string,
    managedAuthPath: string,
    snapshot: ManagedClaudeAuthSnapshot
  ): Promise<void> {
    return this.storage.restoreCredentials(accountId, managedAuthPath, snapshot)
  }

  private restoreManagedOauthSnapshot(
    accountId: string,
    managedAuthPath: string,
    snapshot: ManagedClaudeAuthSnapshot
  ): Promise<void> {
    return this.storage.restoreOauth(accountId, managedAuthPath, snapshot)
  }

  private createManagedAuthDir(
    accountId: string,
    target?: ClaudeAccountAddTarget
  ): Promise<ManagedClaudeAuthLocation> {
    return this.storage.create(accountId, target)
  }

  private assertManagedAuthPath(
    candidatePath: string,
    expectedAccountId?: string
  ): Promise<string> {
    return this.storage.assertOwned(candidatePath, expectedAccountId)
  }

  private safeRemoveManagedAuth(accountId: string, candidatePath: string): Promise<void> {
    return this.storage.remove(accountId, candidatePath)
  }

  private runClaudeCommand(
    args: string[],
    configDir: { windowsPath: string; linuxPath: string | null; wslDistro: string | null },
    timeoutMs: number,
    options?: { allowFailure?: boolean; signal?: AbortSignal; keepStdinOpen?: boolean }
  ): Promise<string> {
    return runClaudeCommandProcess(args, configDir, timeoutMs, options)
  }

  private parseJsonObject(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown
      return this.asRecord(parsed)
    } catch {
      return null
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }
    return value as Record<string, unknown>
  }

  private readString(value: Record<string, unknown> | null, key: string): string | null {
    const field = value?.[key]
    return typeof field === 'string' ? field : null
  }

  private normalizeField(value: string | null | undefined): string | null {
    if (!value) {
      return null
    }
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
}
