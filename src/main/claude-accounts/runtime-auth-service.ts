import type { Store } from '../persistence'
import { isWslDistroRunning } from '../wsl-background-distro-gate'
import { ClaudeRuntimeAuthSync } from './runtime-auth/runtime-auth-sync'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'
import {
  getSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from './runtime-selection'
export type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'

/** Single owner for captured managed credentials and verified runtime readback. */
export class ClaudeRuntimeAuthService extends ClaudeRuntimeAuthSync {
  constructor(
    store: Store,
    private readonly isDistroRunning = isWslDistroRunning
  ) {
    super(store)
    this.lastSyncedAccountId = getSelectedClaudeAccountIdForTarget(store.getSettings(), {
      runtime: 'host'
    })
    void this.syncForCurrentSelection().catch((error: unknown) => {
      console.warn('[claude-runtime-auth] Failed to sync runtime auth state:', error)
    })
  }

  async prepareForClaudeLaunch(
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRuntimeAuthPreparation> {
    const effective = target ?? this.getDefaultAccountSelectionTarget()
    await this.syncForCurrentSelection(effective)
    return this.getPreparation(effective)
  }

  async prepareForRateLimitFetch(
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRuntimeAuthPreparation> {
    const effective = this.resolveWslDefaultTarget(
      target ?? this.getDefaultAccountSelectionTarget()
    )
    if (
      effective.runtime === 'wsl' &&
      effective.wslDistro &&
      !(await this.isDistroRunning(effective.wslDistro))
    ) {
      return {
        configDir: '',
        envPatch: {},
        stripAuthEnv: false,
        provenance: 'managed:unavailable',
        usageError: `WSL distro ${effective.wslDistro} is not running.`
      }
    }
    try {
      await this.syncForCurrentSelection(effective)
      return this.getPreparation(effective)
    } catch (error) {
      return {
        configDir: '',
        envPatch: {},
        stripAuthEnv: false,
        provenance: 'managed:unavailable',
        usageError: error instanceof Error ? error.message : String(error)
      }
    }
  }

  syncForCurrentSelection(target?: ClaudeAccountSelectionTarget): Promise<void> {
    return this.serializeMutation(() =>
      this.doSyncForCurrentSelection(target ?? this.getDefaultAccountSelectionTarget())
    )
  }

  forceMaterializeCurrentSelectionForRollback(): Promise<void> {
    return this.serializeMutation(async () => {
      const settings = this.store.getSettings()
      if (!settings.activeClaudeManagedAccountId) {
        const previous = this.getActiveAccount(
          settings.claudeManagedAccounts,
          this.lastSyncedAccountId
        )
        await this.restoreSystemDefaultSnapshot(
          previous ? await this.readManagedCredentials(previous) : null,
          previous ? await this.readManagedOauthAccount(previous) : undefined
        )
        this.lastSyncedAccountId = null
        return
      }
      await this.doSyncForCurrentSelection()
    })
  }

  getRuntimeConfigDir(target?: ClaudeAccountSelectionTarget): string {
    return this.getPreparation(target).configDir
  }

  getSystemDefaultSummary(): { systemDefaultEmail?: string; systemDefaultMayBeCopied?: boolean } {
    const identity = this.readIdentityFromOauthAccount(this.readRuntimeOauthAccount())
    return identity.email
      ? {
          systemDefaultEmail: identity.email,
          ...(this.store
            .getSettings()
            .claudeManagedAccounts.some((account) => account.email === identity.email)
            ? { systemDefaultMayBeCopied: true }
            : {})
        }
      : {}
  }

  private serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(fn, fn)
    this.mutationQueue = next.catch(() => {})
    return next
  }

  clearLastWrittenCredentialsJson(
    accountId = this.store.getSettings().activeClaudeManagedAccountId
  ): void {
    if (accountId === this.store.getSettings().activeClaudeManagedAccountId)
      {this.lastWrittenCredentialsJson = null}
    this.skipNextReadBackForAccountId = accountId
  }
}
