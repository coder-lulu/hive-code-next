import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import {
  emptyClaudeAccountsState,
  emptyCodexAccountsState
} from '@/runtime/runtime-provider-accounts-client'
import {
  createClaudeAccountActionRunner,
  createCodexAccountActionRunner
} from './accounts-pane-account-actions'

describe('provider account actions across scope changes', () => {
  it.each([
    ['codex', false],
    ['claude', false],
    ['codex', true],
    ['claude', true]
  ] as const)(
    'does not publish an old %s roster after switching owners (remote: %s)',
    async (provider, isRemoteAccountScope) => {
      let complete: (() => void) | undefined
      const pending = new Promise<void>((resolve) => {
        complete = resolve
      })
      let currentScope = true
      const setAccounts = vi.fn()
      const fetchSettings = vi.fn(async () => {})
      const recordFeatureInteraction = vi.fn()
      const common = {
        settings: getDefaultSettings('/tmp'),
        accountRuntime: { runtime: 'host' as const, label: 'This device' },
        isRemoteAccountScope,
        isCurrentScope: () => currentScope,
        fetchSettings,
        recordFeatureInteraction
      }
      // A local operation may still persist after the pane has switched owners.
      const action =
        provider === 'codex'
          ? createCodexAccountActionRunner({
              ...common,
              codexAccounts: emptyCodexAccountsState(),
              setCodexAccounts: setAccounts,
              setCodexAccountsLoaded: vi.fn(),
              setCodexAction: vi.fn()
            })('select:system', async () => {
              await pending
              return emptyCodexAccountsState()
            })
          : createClaudeAccountActionRunner({
              ...common,
              claudeAccounts: emptyClaudeAccountsState(),
              setClaudeAccounts: setAccounts,
              setClaudeAction: vi.fn()
            })('select:system', async () => {
              await pending
              return emptyClaudeAccountsState()
            })
      currentScope = false
      complete?.()
      await action

      expect(setAccounts).not.toHaveBeenCalled()
      expect(recordFeatureInteraction).not.toHaveBeenCalled()
      expect(fetchSettings).toHaveBeenCalledTimes(isRemoteAccountScope ? 0 : 1)
    }
  )
})
